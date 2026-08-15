/**
 * dsh-plugin-fish-tts — host half.
 *
 * Routes on the harness webserver:
 *   POST /fish-tts/synthesize  { text, format? } -> raw audio bytes
 *   GET  /fish-tts/status      -> effective config summary (never the key)
 *   GET  /fish-tts/config      -> editable config (never the key)
 *   PUT  /fish-tts/config      -> { model?, voice?, format?, apiKey?, clearKey? }
 *   GET  /fish-tts/models      -> Fish Audio TTS model ids (API when reachable, curated fallback)
 *
 * User-editable settings persist to $DSH_HOME/fish-tts/settings.json. An
 * API key stored there is encrypted with AES-256-GCM under a per-machine key
 * file ($DSH_HOME/fish-tts/key.bin, created once, ACL-tightened on Windows).
 * The key never appears in any GET response, log line, or the repository.
 *
 * Threat model (local-only): every route rejects non-loopback peers
 * (remoteAddress must be 127.0.0.1 / ::1 / ::ffff:127.0.0.1) with 403, and
 * write routes additionally require application/json + same-origin/loopback
 * Origin. Proxy URLs with userinfo are refused at save time so credentials
 * can never be echoed by GET responses.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { connect } from 'node:net'
import { spawnSync } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
// Type-only: merges ctx.webServer into Context.
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'fish-tts'

export interface Config {
  /** Default TTS model; overridden by the saved settings file. */
  model?: string
  /** Default voice reference_id; overridden by the saved settings file. */
  voice?: string
  format?: string
  apiKey?: string
  apiKeyFile?: string
  /** Optional HTTP(S) proxy for Fish API calls; overridden by the saved settings file. */
  proxy?: string
  /** Settings directory; defaults to $DSH_HOME/fish-tts. */
  stateDir?: string
}

export const Config: s<Config> = s.object({
  model: s.string().default(''),
  voice: s.string().default(''),
  format: s.string().default('wav'),
  apiKey: s.string().default(''),
  apiKeyFile: s.string().default(''),
  proxy: s.string().default(''),
  stateDir: s.string().default(''),
})

const API_URL = 'https://api.fish.audio/v1/tts'
const MODELS_URL = 'https://api.fish.audio/v1/models'
const MAX_TEXT_CHARS = 12000
const MAX_BODY_BYTES = 1 << 18
const CACHE_LIMIT = 200
const FORMATS = new Set(['wav', 'mp3', 'opus', 'pcm'])
const SETTINGS_VERSION = 1
/** Public model fallback; voices are personal and must be set by the user. */
const MODEL_DEFAULT = 's2.1-pro-free'

/** Curated fallback when the live model list cannot be fetched. */
const FALLBACK_MODELS = ['s2.1-pro-free', 's2.1-pro', 's2-pro']

interface ApiKeyCipher {
  iv: string
  tag: string
  data: string
}

interface SettingsFile {
  version: number
  model?: string
  voice?: string
  format?: string
  proxy?: string
  apiKeyCipher?: ApiKeyCipher
}

/** Effective runtime settings (in-memory; the settings file is the source of truth). */
interface EffectiveSettings {
  model: string
  voice: string
  format: string
  proxy: string
  /** Decrypted stored key, or '' when none. */
  storedKey: string
  hasStoredKey: boolean
}

/** Read a KEY=value line from a dotenv-style file. */
function readDotenvKey(path: string, key: string): string {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      if (trimmed.slice(0, eq).trim() === key) {
        return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // missing file is normal
  }
  return ''
}

/** Resolve a Fish API key from the ambient environment (never the store). */
function resolveEnvKey(config: Config): string {
  const fromConfig = (config.apiKey ?? '').trim()
  if (fromConfig !== '') return fromConfig
  const fromEnv = (process.env.FISH_API_KEY ?? '').trim()
  if (fromEnv !== '') return fromEnv
  const file = (config.apiKeyFile ?? '').trim()
  if (file !== '') {
    const key = readDotenvKey(file, 'FISH_API_KEY')
    if (key !== '') return key
  }
  return ''
}

/** Is a TCP port accepting connections on localhost? */
function portOpen(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: timeoutMs })
    const done = (value: boolean): void => { socket.destroy(); resolve(value) }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

/**
 * Normalize a user-configured proxy URL; http/https only.
 *
 * URLs carrying userinfo (username/password) are rejected outright: the
 * saved proxy is echoed by GET /status and GET /config, so credentials in
 * the proxy URL would leak into browser-readable JSON responses (FISH-SEC-001).
 */
function proxyOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username !== '' || parsed.password !== '') return null
    return parsed.href.replace(/\/$/, '')
  } catch {
    return null
  }
}

/**
 * Redact any userinfo from a proxy URL before it reaches a response.
 * Malformed URLs fail closed (return '') so a broken-but-credentialed
 * patch-config value can never be echoed verbatim.
 */
function redactProxy(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username !== '' || parsed.password !== '') {
      parsed.username = ''
      parsed.password = ''
      return parsed.href.replace(/\/$/, '')
    }
    return url
  } catch {
    return ''
  }
}

/** Thrown when a settings patch must not be persisted. */
class SettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsError'
  }
}

/** Validate a proxy value before persisting; throws SettingsError with a
 * user-readable message when the value must not be saved. */
function validateProxyForSave(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  const normalized = proxyOf(trimmed)
  if (normalized === null) {
    throw new SettingsError('proxy must be an http:// or https:// URL without username/password')
  }
  return normalized
}

/**
 * Sanitize a seed proxy (bundle-patch default) before it can be persisted:
 * illegal schemes and credential-bearing URLs are dropped entirely — never
 * written to settings.json, never echoed in responses, logs or errors
 * (FISH-SEC-003). Unlike the PUT path this does not throw: a bad seed must
 * not crash plugin startup, it is simply ignored.
 */
function sanitizeSeedProxy(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  try {
    return validateProxyForSave(trimmed)
  } catch {
    return undefined
  }
}

/** Proxy port (default per scheme) for the localhost reachability probe. */
function proxyPortOf(proxyUrl: string): number | null {
  try {
    const parsed = new URL(proxyUrl)
    if (parsed.port !== '') return Number(parsed.port)
    return parsed.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

/** Best-effort Windows ACL tightening: current user only, inheritance removed. */
function tightenAcl(filePath: string): void {
  if (process.platform !== 'win32') return
  const user = process.env.USERNAME
  if (user === undefined) return
  try {
    spawnSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore', timeout: 5000 })
  } catch {
    // non-fatal
  }
}

function stateDirOf(config: Config): string {
  const configured = (config.stateDir ?? '').trim()
  if (configured !== '') return configured
  const home = process.env.DSH_HOME?.trim()
  return join(home !== undefined && home !== '' ? home : join(homedir(), '.dsh'), 'fish-tts')
}

function loadOrCreateKey(dir: string): Buffer {
  const path = join(dir, 'key.bin')
  try {
    const existing = readFileSync(path)
    if (existing.length === 32) {
      // Keep permissions tight even for a key created by an older version.
      try { chmodSync(path, 0o600) } catch { /* non-fatal on win32 */ }
      tightenAcl(path)
      return existing
    }
  } catch {
    // not present — create below
  }
  mkdirSync(dir, { recursive: true })
  const key = randomBytes(32)
  try {
    writeFileSync(path, key, { flag: 'wx', mode: 0o600 })
    tightenAcl(path)
  } catch {
    // raced creation or permissions — fall back to reading whatever won
  }
  const created = readFileSync(path)
  return created.length === 32 ? created : key
}

function encrypt(secret: string, key: Buffer): ApiKeyCipher {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

function decrypt(cipherText: ApiKeyCipher, key: Buffer): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(cipherText.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(cipherText.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(cipherText.data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return ''
  }
}

class SettingsStore {
  private readonly filePath: string
  private readonly key: Buffer
  private file: SettingsFile
  /** True when settings.json could not be parsed at all (or was not an
   * object) — only then is the file parked as .corrupt-*; a well-formed v0
   * file is migrated in place instead. */
  private parseFailed = false

  constructor(dir: string, seed: { model: string; voice: string; format: string; proxy: string }) {
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'settings.json')
    this.key = loadOrCreateKey(dir)
    let hadContent = false
    try {
      hadContent = existsSync(this.filePath) && readFileSync(this.filePath).length > 0
    } catch {
      hadContent = false
    }
    this.file = this.read()
    if (this.file.version === 0 && hadContent && this.parseFailed) {
      // The file existed but did not parse — never silently destroy user
      // data (including the key ciphertext): park it aside first.
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        // keep going; the fresh store is still usable
      }
    }
    if (this.file.version === 0) {
      // First run: migrate the bundle-patch defaults (if any) into the store,
      // preserving any key material already present. The seed proxy goes
      // through the same validation as PUT saves (FISH-SEC-003).
      this.file = {
        version: SETTINGS_VERSION,
        model: this.file.model ?? seed.model,
        voice: this.file.voice ?? seed.voice,
        format: this.file.format ?? seed.format,
        proxy: sanitizeSeedProxy(this.file.proxy ?? seed.proxy),
        ...(this.file.apiKeyCipher !== undefined ? { apiKeyCipher: this.file.apiKeyCipher } : {}),
      }
      this.write()
    }
    // Stores written by older versions may still carry an illegal or
    // credential-bearing proxy: converge it to unset and persist the cleanup
    // so plaintext credentials never linger on disk.
    const cleanedProxy = sanitizeSeedProxy(this.file.proxy)
    if (cleanedProxy !== this.file.proxy) {
      this.file.proxy = cleanedProxy
      this.write()
    }
  }

  get stateDir(): string {
    return dirname(this.filePath)
  }

  private read(): SettingsFile {
    try {
      // BOM/whitespace-tolerant: a PowerShell-written BOM must not turn a
      // healthy store into a version-0 migration that wipes user data.
      const raw = readFileSync(this.filePath).toString('utf8').replace(/^\uFEFF/, '').trim()
      const parsed = JSON.parse(raw) as Partial<SettingsFile>
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        // Well-formed JSON but not a settings object — treat as corrupt.
        this.parseFailed = true
        return { version: 0 }
      }
      return {
        version: typeof parsed.version === 'number' ? parsed.version : 0,
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        voice: typeof parsed.voice === 'string' ? parsed.voice : undefined,
        format: typeof parsed.format === 'string' ? parsed.format : undefined,
        proxy: typeof parsed.proxy === 'string' ? parsed.proxy : undefined,
        apiKeyCipher: typeof parsed.apiKeyCipher === 'object' && parsed.apiKeyCipher !== null
          ? parsed.apiKeyCipher as ApiKeyCipher
          : undefined,
      }
    } catch {
      this.parseFailed = true
      return { version: 0 }
    }
  }

  private write(): void {
    const temp = `${this.filePath}.tmp-${process.pid}`
    writeFileSync(temp, JSON.stringify(this.file, null, 2), { mode: 0o600 })
    renameSync(temp, this.filePath)
  }

  /** Effective model/voice/format with the patch config as fallback. */
  effective(config: Config): EffectiveSettings {
    const storedKey = this.file.apiKeyCipher !== undefined
      ? decrypt(this.file.apiKeyCipher, this.key)
      : ''
    const model = (this.file.model ?? '').trim() || (config.model ?? '').trim() || MODEL_DEFAULT
    const voice = (this.file.voice ?? '').trim() || (config.voice ?? '').trim() || ''
    const rawFormat = (this.file.format ?? '').trim() || (config.format ?? '').trim() || 'wav'
    const format = FORMATS.has(rawFormat) ? rawFormat : 'wav'
    // One validate-or-sanitize policy across seed, storage and patch config
    // (FISH-SEC-003): illegal or credential-bearing proxies never become
    // effective, are never persisted, and never appear in responses.
    const rawProxy = (this.file.proxy ?? '').trim() || (config.proxy ?? '').trim() || ''
    const proxy = sanitizeSeedProxy(rawProxy) ?? ''
    return { model, voice, format, proxy, storedKey, hasStoredKey: this.file.apiKeyCipher !== undefined }
  }

  /** Apply an edit patch; empty strings clear the field, undefined keeps it. */
  update(patch: {
    model?: string
    voice?: string
    format?: string
    proxy?: string
    apiKey?: string
    clearKey?: boolean
  }): void {
    // Validate the whole patch before mutating any in-memory state, so a
    // rejected proxy (FISH-SEC-001) cannot leave partially-applied fields.
    let nextProxy: string | undefined
    if (patch.proxy !== undefined) {
      nextProxy = patch.proxy.trim() === '' ? '' : validateProxyForSave(patch.proxy)
    }
    if (patch.model !== undefined) {
      this.file.model = patch.model.trim() === '' ? undefined : patch.model.trim()
    }
    if (patch.voice !== undefined) {
      this.file.voice = patch.voice.trim() === '' ? undefined : patch.voice.trim()
    }
    if (patch.format !== undefined) {
      const format = patch.format.trim().toLowerCase()
      this.file.format = FORMATS.has(format) ? format : undefined
    }
    if (patch.proxy !== undefined) {
      this.file.proxy = nextProxy === '' ? undefined : nextProxy
    }
    if (patch.clearKey === true) {
      delete this.file.apiKeyCipher
    } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '') {
      this.file.apiKeyCipher = encrypt(patch.apiKey.trim(), this.key)
    }
    this.write()
  }

  /** Public summary: everything except key material, proxy userinfo redacted. */
  summary(config: Config): {
    model: string
    voice: string
    format: string
    proxy: string
    keyConfigured: boolean
    hasStoredKey: boolean
  } {
    const eff = this.effective(config)
    return {
      model: eff.model,
      voice: eff.voice,
      format: eff.format,
      proxy: redactProxy(eff.proxy),
      keyConfigured: eff.storedKey !== '' || resolveEnvKey(config) !== '',
      hasStoredKey: eff.hasStoredKey,
    }
  }

  /** The API key to use for synthesis: stored > patch config > env > apiKeyFile. */
  apiKey(config: Config): string {
    const eff = this.effective(config)
    return eff.storedKey !== '' ? eff.storedKey : resolveEnvKey(config)
  }
}

interface SynthesisError {
  status: number
  message: string
}

/** Shared ProxyAgent pool so repeated calls reuse connections instead of leaking. */
interface AgentCache {
  get: (proxy: string) => ProxyAgent
}

/** Bound the size of upstream error bodies before they reach responses/logs. */
function truncate(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

class FishTtsError extends Error {
  constructor(readonly status: number, message: string) {
    super(`Fish TTS failed (${status === 0 ? 'network' : status}): ${truncate(message)}`)
    this.name = 'FishTtsError'
  }
}

/** POST the synthesis request; returns audio bytes. */
async function synthesize(
  text: string,
  voice: string,
  model: string,
  format: string,
  apiKey: string,
  proxies: readonly string[],
  agents: AgentCache,
): Promise<Buffer> {
  const payload = JSON.stringify({
    text,
    reference_id: voice === '' ? null : voice,
    format,
    normalize: true,
    latency: 'balanced',
  })
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    model,
  }
  const attempts: Array<string | null> = [...proxies, null]
  let lastError: SynthesisError = { status: 0, message: 'unknown error' }
  for (const proxy of attempts) {
    try {
      const signal = AbortSignal.timeout(60_000)
      const response = proxy === null
        ? await undiciFetch(API_URL, { method: 'POST', headers, body: payload, signal })
        : await undiciFetch(API_URL, { method: 'POST', headers, body: payload, dispatcher: agents.get(proxy), signal })
      if (!response.ok) {
        const message = truncate(await response.text().catch(() => ''))
        lastError = { status: response.status, message }
        // 4xx is an auth/usage problem — retrying through another proxy cannot fix it.
        if (response.status >= 400 && response.status < 500) {
          throw new FishTtsError(response.status, message)
        }
        continue
      }
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length < 64) {
        lastError = { status: 0, message: 'empty audio response' }
        continue
      }
      return body
    } catch (error) {
      if (error instanceof FishTtsError) throw error
      lastError = { status: 0, message: error instanceof Error ? error.message : String(error) }
    }
  }
  throw new FishTtsError(lastError.status, lastError.message)
}

/** Fetch TTS model ids from Fish Audio; returns [] when unavailable. */
async function fetchModelIds(apiKey: string, proxies: readonly string[], agents: AgentCache): Promise<string[]> {
  for (const proxy of [...proxies, null]) {
    try {
      const signal = AbortSignal.timeout(20_000)
      const response = proxy === null
        ? await undiciFetch(MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` }, signal })
        : await undiciFetch(MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` }, dispatcher: agents.get(proxy), signal })
      if (!response.ok) return []
      const payload = await response.json() as Array<Record<string, unknown>>
      const ids = payload
        .filter(item => item.title !== undefined)
        .map(item => (item.model_id ?? item.title) as string | undefined)
        .filter((id): id is string => typeof id === 'string' && id !== '')
      return ids.length > 0 ? ids : []
    } catch {
      // try the next proxy
    }
  }
  return []
}

/** Read and parse a bounded JSON body. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Audio content-type per format (opus → ogg container, pcm → l16). */
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  pcm: 'audio/l16',
}

export function apply(ctx: Context, config: Config): void {
  const store = new SettingsStore(stateDirOf(config), {
    model: config.model ?? '',
    voice: config.voice ?? '',
    format: config.format ?? 'wav',
    proxy: config.proxy ?? '',
  })
  const cache = new Map<string, Buffer>()
  const agents = new Map<string, ProxyAgent>()
  const getAgent = (proxy: string): ProxyAgent => {
    let agent = agents.get(proxy)
    if (agent === undefined) {
      agent = new ProxyAgent(proxy)
      agents.set(proxy, agent)
    }
    return agent
  }
  ctx.effect(() => () => {
    for (const agent of agents.values()) void agent.close()
    agents.clear()
  }, 'fish-tts: close proxy agents')

  const cacheKey = (text: string): string => createHash('sha256').update(text).digest('hex')

  const buildProxies = async (): Promise<string[]> => {
    // Preference: the saved/configured proxy first (with a fast localhost
    // reachability check so a down Clash-style proxy is skipped instantly),
    // then the ambient env proxies.
    const proxies: string[] = []
    const preferred = store.effective(config).proxy
    if (preferred !== '') {
      const normalized = proxyOf(preferred)
      if (normalized !== null) {
        try {
          const parsed = new URL(normalized)
          // Node's URL keeps IPv6 hosts bracketed: '[::1]'.
          const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1' || parsed.hostname === '[::1]'
          const port = proxyPortOf(normalized)
          if (!local || port === null || await portOpen(port)) proxies.push(normalized)
        } catch {
          // malformed proxy URL — skip
        }
      }
    }
    const envProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
    const envNormalized = proxyOf(envProxy ?? '')
    if (envNormalized !== null && !proxies.includes(envNormalized)) proxies.push(envNormalized)
    return proxies
  }

  // Local-only threat model (FISH-SEC-002): this plugin serves configuration,
  // model and synthesis endpoints that consume API quota and modify settings.
  // The harness web server may listen on 0.0.0.0, so the plugin itself must
  // reject peers that are not on the loopback interface. CORS/Origin checks
  // are not authentication — the remote-address check is the enforcement.
  const isLoopbackAddress = (address: string | undefined): boolean => {
    if (address === undefined || address === '') return false
    const clean = address.replace(/^::ffff:/, '').toLowerCase()
    return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost'
  }

  const guardLoopback = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: 'non-loopback-forbidden' })
      return false
    }
    return true
  }

  // Cross-origin write protection: browser forms cannot send JSON, and a
  // cross-origin fetch with a JSON content-type would need a CORS preflight
  // this server never answers. Defense in depth: when an Origin header is
  // present it must name the request's own host (same-origin) or the loopback.
  const guardWrite = (req: IncomingMessage, res: ServerResponse): boolean => {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      sendJson(res, 415, { ok: false, error: 'content-type-json-required' })
      return false
    }
    const origin = req.headers.origin
    if (origin !== undefined) {
      let originHost = ''
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = ''
      }
      const hostHeader = req.headers.host ?? ''
      const sameOrigin = originHost !== '' && originHost === hostHeader
      const loopback = originHost.startsWith('127.0.0.1:')
        || originHost.startsWith('localhost:')
        || originHost.startsWith('[::1]:')
      if (!sameOrigin && !loopback) {
        sendJson(res, 403, { ok: false, error: 'cross-origin-forbidden' })
        return false
      }
    }
    return true
  }

  let mounted = false
  const mount = (): void => {
    const web = ctx.get('webServer')
    if (web === undefined || mounted) return
    mounted = true

    ctx.effect(() => web.register({
      kind: 'exact',
      path: '/fish-tts/synthesize',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!guardWrite(req, res)) return
        if (!guardLoopback(req, res)) return
        const body = await readJsonBody(req)
        const text = typeof body?.['text'] === 'string' ? body['text'] : ''
        if (text.trim() === '') {
          sendJson(res, 400, { ok: false, error: 'text-required' })
          return
        }
        if (text.length > MAX_TEXT_CHARS) {
          sendJson(res, 413, { ok: false, error: 'text-too-large' })
          return
        }
        const eff = store.effective(config)
        const requestedFormat = typeof body?.['format'] === 'string' && FORMATS.has(body['format'])
          ? body['format']
          : eff.format

        if (eff.voice === '') {
          sendJson(res, 400, { ok: false, error: 'voice-required', message: 'voice reference_id is required (set it in the plugin settings)' })
          return
        }
        const apiKey = store.apiKey(config)
        if (apiKey === '') {
          sendJson(res, 500, { ok: false, error: 'no-api-key' })
          return
        }

        const key = cacheKey(`${eff.model}\u0000${eff.voice}\u0000${requestedFormat}\u0000${text}`)
        const cached = cache.get(key)
        if (cached !== undefined) {
          res.writeHead(200, {
            'content-type': AUDIO_CONTENT_TYPES[requestedFormat] ?? 'audio/wav',
            'content-length': cached.length,
            'cache-control': 'private, max-age=86400',
          })
          res.end(cached)
          return
        }

        const proxies = await buildProxies()
        try {
          const audio = await synthesize(text, eff.voice, eff.model, requestedFormat, apiKey, proxies, { get: getAgent })
          if (cache.size >= CACHE_LIMIT) {
            const oldest = cache.keys().next().value
            if (oldest !== undefined) cache.delete(oldest)
          }
          cache.set(key, audio)
          res.writeHead(200, {
            'content-type': AUDIO_CONTENT_TYPES[requestedFormat] ?? 'audio/wav',
            'content-length': audio.length,
            'cache-control': 'private, max-age=86400',
          })
          res.end(audio)
        } catch (error) {
          const status = error instanceof FishTtsError && error.status !== 0 ? error.status : 502
          sendJson(res, status, {
            ok: false,
            error: 'synthesis-failed',
            message: truncate(error instanceof Error ? error.message : 'synthesis failed'),
          })
        }
      },
    }), 'fish-tts: synthesize route')

    ctx.effect(() => web.register({
      kind: 'exact',
      path: '/fish-tts/status',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!guardLoopback(req, res)) return
        sendJson(res, 200, { ok: true, ...store.summary(config), cacheEntries: cache.size })
      },
    }), 'fish-tts: status route')

    ctx.effect(() => web.register({
      kind: 'exact',
      path: '/fish-tts/config',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method === 'GET') {
          const eff = store.effective(config)
          sendJson(res, 200, {
            ok: true,
            model: eff.model,
            voice: eff.voice,
            format: eff.format,
            proxy: redactProxy(eff.proxy),
            keyConfigured: eff.storedKey !== '' || resolveEnvKey(config) !== '',
            hasStoredKey: eff.hasStoredKey,
          })
          return
        }
        if (req.method === 'PUT') {
          if (!guardWrite(req, res)) return
          const body = await readJsonBody(req)
          if (body === null) {
            sendJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const patch: Parameters<SettingsStore['update']>[0] = {}
          if (typeof body['model'] === 'string') patch.model = body['model']
          if (typeof body['voice'] === 'string') patch.voice = body['voice']
          if (typeof body['format'] === 'string') patch.format = body['format']
          if (typeof body['proxy'] === 'string') patch.proxy = body['proxy']
          if (typeof body['apiKey'] === 'string') patch.apiKey = body['apiKey']
          if (body['clearKey'] === true) patch.clearKey = true
          try {
            store.update(patch)
          } catch (error) {
            if (error instanceof SettingsError) {
              sendJson(res, 400, { ok: false, error: 'invalid-proxy', message: truncate(error.message) })
            } else {
              sendJson(res, 500, { ok: false, error: 'save-failed', message: truncate(error instanceof Error ? error.message : 'save failed') })
            }
            return
          }
          sendJson(res, 200, { ok: true, ...store.summary(config) })
          return
        }
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    }), 'fish-tts: config route')

    ctx.effect(() => web.register({
      kind: 'exact',
      path: '/fish-tts/models',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!guardLoopback(req, res)) return
        const apiKey = store.apiKey(config)
        const proxies = apiKey === '' ? [] : await buildProxies()
        const ids = apiKey === '' ? [] : await fetchModelIds(apiKey, proxies, { get: getAgent })
        sendJson(res, 200, { ok: true, models: ids.length > 0 ? ids : FALLBACK_MODELS, live: ids.length > 0 })
      },
    }), 'fish-tts: models route')
  }

  if (ctx.get('webServer') !== undefined) {
    mount()
  } else {
    // The webserver row can activate after this bundle row; re-attempt on service arrival.
    ctx.on('internal/service', (service: string) => {
      if (service === 'webServer') mount()
    })
  }
}

/**
 * fish_tts_speak — model-callable speech tool for chat channels (IM bots, …).
 *
 * fish-tts owns synthesis, line processing, rate limiting, loudness and the
 * audio file lifecycle; a channel plugin only registers a delivery hook and
 * keeps its own outbound filtering. The tool contract was negotiated with the
 * QQ bot fork maintainer (2026-10):
 *
 *   input   { text, voice?, format? }
 *   output  { bytes, chars, format, mime, delivered, channel? | fileName?, voice? }
 *   errors  disabled | rate-limited | text-too-long | text-empty |
 *           voice-not-configured | auth | quota | network | failed |
 *           voice-rejected | cancelled
 *
 * Everything here is framework-free; the only node imports are fs/crypto/path
 * for the audio file lifecycle. Unit tests pin the two incident classes: Fish
 * bracket tags must survive cleaning verbatim (a channel-side cleaner once
 * stripped the brackets and Fish read the bare word aloud), and a rate-limit
 * slot claimed before synthesis must be released again when nothing was sent.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { SavedVoice } from './voices.ts'

/** Tool name as the model sees it; channels whitelist this name. */
export const SPEAK_TOOL_NAME = 'fish_tts_speak'

/** Formats a voice bubble can use (IM channels accept silk/mp3/wav/ogg; opus is ogg). */
export const SPEAK_FORMATS = new Set(['mp3', 'wav', 'opus'])
export const DEFAULT_SPEAK_FORMAT = 'mp3'

/** Audio content-type per format (opus → ogg container). */
export const SPEAK_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/ogg',
}

/** Tool-level timeout: 15 s synthesis budget + 20 s delivery ceiling + slack.
 * The harness does not enforce this, so it stays an honest worst-case figure. */
export const SPEAK_TIMEOUT_MS = 40_000
/** Total budget for one tool-path synthesis across all proxy attempts. */
export const SPEAK_SYNTH_TIMEOUT_MS = 15_000
/** Hard ceiling for one delivery attempt; a hung channel must not pin the
 * exclusive tool pipeline (the harness does not enforce timeoutMs itself).
 * 20 s per the first channel's feedback: slow uploads hit the old 10 s. */
export const SPEAK_DELIVER_TIMEOUT_MS = 20_000
/** Generated voice files older than this are deleted opportunistically. */
export const SPEAK_FILE_TTL_MS = 24 * 60 * 60 * 1000
/** Reject absurdly large audio before writing it to disk. */
export const SPEAK_MAX_FILE_BYTES = 10 * 1024 * 1024

/** User-configurable speech-tool settings (persisted in settings.json). */
export interface SpeakSettings {
  enabled: boolean
  format: string
  maxChars: number
  perMinute: number
  loudness: boolean
  volumeDb: number
}

export const DEFAULT_SPEAK_SETTINGS: SpeakSettings = {
  enabled: true,
  format: DEFAULT_SPEAK_FORMAT,
  maxChars: 300,
  perMinute: 1,
  loudness: true,
  volumeDb: 0,
}

const MIN_MAX_CHARS = 50
const MAX_MAX_CHARS = 1000
const MAX_PER_MINUTE = 30
const MIN_VOLUME_DB = -20
const MAX_VOLUME_DB = 20

/**
 * Validate one candidate SpeakSettings object read from storage or a PUT
 * body. Whole-object: one bad field rejects the object so a partially
 * corrupt file can never half-apply. `null` means "not a speak settings
 * object"; callers fall back to the defaults.
 */
export function normalizeSpeakSettings(value: unknown): SpeakSettings | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.enabled !== 'boolean') return null
  if (typeof raw.format !== 'string' || !SPEAK_FORMATS.has(raw.format)) return null
  if (typeof raw.maxChars !== 'number' || !Number.isInteger(raw.maxChars)
    || raw.maxChars < MIN_MAX_CHARS || raw.maxChars > MAX_MAX_CHARS) return null
  if (typeof raw.perMinute !== 'number' || !Number.isInteger(raw.perMinute)
    || raw.perMinute < 0 || raw.perMinute > MAX_PER_MINUTE) return null
  if (typeof raw.loudness !== 'boolean') return null
  if (typeof raw.volumeDb !== 'number' || !Number.isFinite(raw.volumeDb)
    || raw.volumeDb < MIN_VOLUME_DB || raw.volumeDb > MAX_VOLUME_DB) return null
  return {
    enabled: raw.enabled,
    format: raw.format,
    maxChars: raw.maxChars,
    perMinute: raw.perMinute,
    loudness: raw.loudness,
    volumeDb: raw.volumeDb,
  }
}

/**
 * Validate a partial speak patch (only the keys present are checked and
 * returned). `null` means at least one provided key is invalid; the caller
 * must reject the whole save.
 */
export function normalizeSpeakPatch(value: unknown): Partial<SpeakSettings> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const patch: Partial<SpeakSettings> = {}
  if (Object.hasOwn(raw, 'enabled')) {
    if (typeof raw.enabled !== 'boolean') return null
    patch.enabled = raw.enabled
  }
  if (Object.hasOwn(raw, 'format')) {
    if (typeof raw.format !== 'string' || !SPEAK_FORMATS.has(raw.format)) return null
    patch.format = raw.format
  }
  if (Object.hasOwn(raw, 'maxChars')) {
    if (typeof raw.maxChars !== 'number' || !Number.isInteger(raw.maxChars)
      || raw.maxChars < MIN_MAX_CHARS || raw.maxChars > MAX_MAX_CHARS) return null
    patch.maxChars = raw.maxChars
  }
  if (Object.hasOwn(raw, 'perMinute')) {
    if (typeof raw.perMinute !== 'number' || !Number.isInteger(raw.perMinute)
      || raw.perMinute < 0 || raw.perMinute > MAX_PER_MINUTE) return null
    patch.perMinute = raw.perMinute
  }
  if (Object.hasOwn(raw, 'loudness')) {
    if (typeof raw.loudness !== 'boolean') return null
    patch.loudness = raw.loudness
  }
  if (Object.hasOwn(raw, 'volumeDb')) {
    if (typeof raw.volumeDb !== 'number' || !Number.isFinite(raw.volumeDb)
      || raw.volumeDb < MIN_VOLUME_DB || raw.volumeDb > MAX_VOLUME_DB) return null
    patch.volumeDb = raw.volumeDb
  }
  return patch
}

/**
 * Fish emotion/sound tags that must pass through to the API verbatim.
 * Anything else bracketed is treated as a stray tag and dropped instead of
 * being read aloud (the incident class this module exists to prevent).
 */
export const SPEECH_TAGS: ReadonlySet<string> = new Set([
  // emotion
  'angry', 'sad', 'embarrassed', 'emphasis', 'whispering', 'soft', 'breathy', 'excited',
  // sound
  'laughing', 'chuckling', 'sighing', 'sobbing', 'crying loudly', 'panting', 'groaning',
  'moaning', 'clear throat', 'pause', 'long pause', 'crowd laughing', 'background laughter',
  'audience laughing',
])

/**
 * Clean a model-authored line into speakable text. The square brackets of
 * markdown are intentionally NOT in the symbol set — only link/image syntax
 * with a real URL scheme is unwrapped, so `[soft]` can never lose its
 * brackets here. Chinese-parenthesis asides (（尾巴晃来晃去）) pass through
 * untouched.
 */
export function cleanSpeechText(input: string): string {
  return input
    // code first: fences and inline spans are never speakable
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    // images entirely; links keep their label only when the target is a URL
    // and the label is not itself a documented Fish tag
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\((?:https?:\/\/|mailto:|www\.)[^)\s]*\)/g, (link: string, label: string) =>
      SPEECH_TAGS.has(label.trim().toLowerCase()) ? link : label)
    // bare URLs
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, ' ')
    // emoji, variation selectors, zero-width joiners
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    // markdown emphasis/heading/quote/table/strike symbols — brackets excluded
    .replace(/[*_#>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Drop bracketed tokens that are not documented Fish tags. A known tag
 * (`[soft]`, `[crying loudly]`, case-insensitive) survives verbatim; an
 * English-tag-shaped unknown token (letters/digits/spaces — the shape of
 * emotion/sound tags) is removed so Fish cannot read the bare word aloud.
 * Anything else — CJK references like「[见附录第三节]」, citations like
 * `[1]` — is content and is left untouched.
 */
const TAG_LIKE = /^[a-z][a-z0-9 ]{0,31}$/i

export function dropUnknownTags(text: string): string {
  return text
    .replace(/\[([^[\]]{1,32})\]/g, (token: string, inner: string) => {
      const trimmed = inner.trim()
      if (SPEECH_TAGS.has(trimmed.toLowerCase())) return token
      return TAG_LIKE.test(trimmed) ? ' ' : token
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Per-conversation send slots. The slot is claimed BEFORE synthesis so the
 * multi-second synthesis window cannot be raced by a parallel call, and
 * released when a failed attempt sent nothing — the cooldown counts from the
 * last successful send, not from attempts.
 */
export class RateLimiter {
  private readonly last = new Map<string, number>()
  private ops = 0

  /**
   * Claim the send slot for `key`.
   * @returns `ok: true` with the claim token (pass back to {@link release}),
   *   or `ok: false` with the whole seconds until the slot frees up.
   */
  tryAcquire(key: string, intervalMs: number, now = Date.now()): { ok: true; token: number } | { ok: false; retryAfterSec: number } {
    // Opportunistic prune so long-running processes do not grow the map with
    // dead sessions: stale entries are worthless once past the interval. The
    // threshold rides on the CURRENT call's intervalMs — good enough for a
    // cleanup hint and harmless if perMinute changes at runtime.
    if (++this.ops % 256 === 0 && this.last.size > 16) {
      for (const [entry, at] of this.last) {
        if (now - at >= intervalMs) this.last.delete(entry)
      }
    }
    const previous = this.last.get(key)
    if (previous !== undefined) {
      const elapsed = now - previous
      if (elapsed < intervalMs) {
        // Capped at one interval: a rolled-back system clock must not turn
        // the cooldown into a self-denial with a giant wait.
        const cap = Math.max(1, Math.ceil(intervalMs / 1000))
        return { ok: false, retryAfterSec: Math.min(cap, Math.max(1, Math.ceil((intervalMs - elapsed) / 1000))) }
      }
    }
    this.last.set(key, now)
    return { ok: true, token: now }
  }

  /** Give the slot back after a failed attempt (nothing was sent). */
  release(key: string, token: number): void {
    if (this.last.get(key) === token) this.last.delete(key)
  }
}

/** Input handed to a channel delivery hook. Never contains secrets or full
 * identity: paths point inside the plugin's own out directory, and the
 * session id is the harness session, not a channel openid. */
export interface SpeakDeliveryInput {
  audioPath: string
  mime: string
  /** The exact text that was synthesized — the channel runs its outbound filter over it. */
  text: string
  sessionId: string
  /** The harness agent object, pass-through for channel-side target resolution. */
  agent?: unknown
  /** The tool call's abort signal. Channels should pass it to their send so an
   * interrupted turn stops the upload; a delivery already on the wire cannot
   * be recalled, so this is best-effort. */
  signal?: AbortSignal
}

/**
 * One channel's delivery hook. `claims` decides whether a session belongs to
 * the channel — return exactly `true` to claim; `false`, a throw, or any
 * other value counts as "not claimed" (fail closed, keep looking). When
 * `claims` is omitted the channel claims everything. `deliver` runs the
 * channel's outbound filter and sends the voice — it must throw when the
 * message is rejected or the target cannot be resolved, and the tool
 * surfaces that as `voice-rejected`.
 */
export interface SpeakDelivery {
  claims?: (sessionId: string, agent?: unknown) => boolean
  deliver: (input: SpeakDeliveryInput) => Promise<void>
}

/** Registry of channel delivery hooks, exposed to channels as `ctx.fishTts`. */
export class DeliveryRegistry {
  private readonly entries = new Map<string, SpeakDelivery>()

  /** Register (or replace) a channel's hook; returns the exact disposer. */
  register(channel: string, delivery: SpeakDelivery): () => void {
    this.entries.set(channel, delivery)
    return () => {
      if (this.entries.get(channel) === delivery) this.entries.delete(channel)
    }
  }

  get size(): number {
    return this.entries.size
  }

  /** First registered channel that claims this session, in registration
   * order. A `claims` hook that throws is treated as "not claimed" so one
   * broken channel cannot take the tool call down — keep looking. */
  find(sessionId: string, agent?: unknown): { channel: string; delivery: SpeakDelivery } | undefined {
    for (const [channel, delivery] of this.entries) {
      let claimed = true
      if (delivery.claims !== undefined) {
        try {
          claimed = delivery.claims(sessionId, agent) === true
        } catch {
          claimed = false
        }
      }
      if (claimed) return { channel, delivery }
    }
    return undefined
  }
}

/** Resolve the `voice` argument: saved-voice id or name first, then a raw
 * Fish reference_id. `null` = nothing usable (no default configured). */
export function resolveSpeakVoice(
  requested: unknown,
  savedVoices: readonly SavedVoice[],
  defaultVoice: string,
): { voice: string; from: 'saved' | 'raw' | 'default' } | null {
  if (typeof requested === 'string' && requested.trim() !== '') {
    const wanted = requested.trim()
    const saved = savedVoices.find(entry => entry.id === wanted)
      ?? savedVoices.find(entry => entry.name.toLowerCase() === wanted.toLowerCase())
    if (saved !== undefined) return { voice: saved.id, from: 'saved' }
    return { voice: wanted, from: 'raw' }
  }
  const fallback = defaultVoice.trim()
  return fallback === '' ? null : { voice: fallback, from: 'default' }
}

/** One synthesis request the tool hands to the host. */
export interface SpeakSynthesisRequest {
  text: string
  voice: string
  model: string
  format: string
  volumeDb: number
  loudness: boolean
  signal?: AbortSignal
}

/** Structural subset of the host-side tool execution context. */
export interface SpeakExec {
  signal?: AbortSignal
  agent?: unknown
}

/** Minimal `tools.register` surface (host tools service). */
export interface SpeakToolDeps {
  /** Live speech-tool settings (re-read on every call; changes apply at once). */
  settings: () => SpeakSettings
  /** Effective default voice reference_id ('' when unset). */
  defaultVoice: () => string
  /** Saved voice bookmarks for id/name resolution. */
  savedVoices: () => readonly SavedVoice[]
  /** Whether a Fish API key is configured. */
  hasApiKey: () => boolean
  /** Effective model id. */
  model: () => string
  /** Host synthesis (cache + proxy handling live there). */
  synthesize: (request: SpeakSynthesisRequest) => Promise<Buffer>
  deliveries: DeliveryRegistry
  /** Shared per-conversation send-slot limiter. */
  limiter: RateLimiter
  /** Directory the generated files are written to. */
  outDir: () => string
  /** Delivery ceiling override (tests); defaults to SPEAK_DELIVER_TIMEOUT_MS. */
  deliverTimeoutMs?: number
  log: (message: string) => void
  now?: () => number
}

interface TextContentBlock {
  type: 'text'
  text: string
}

interface SpeakArgs {
  text?: unknown
  voice?: unknown
  format?: unknown
}

/** Error codes are prefixed into the message so the model can branch on them
 * (the requirement's model-readable error table) without extra plumbing. */
function speakError(code: string, message: string): Error {
  return new Error(`${SPEAK_TOOL_NAME}(${code}): ${message}`)
}

/**
 * Redact credential-bearing fragments, local paths, and bound the length of
 * upstream error text before it reaches the model context or logs: a hostile
 * proxy error page must not be able to echo the API key, and channel
 * exception text must not carry the out-dir path or identity data verbatim.
 */
export function sanitizeErrorDetail(text: string, max = 200): string {
  return text
    .replace(/bearer\s+\S+/gi, '[redacted]')
    .replace(/authorization"?\s*[:=]\s*"?[^,";\s]+/gi, '[redacted]')
    .replace(/[A-Za-z]:\\[^\s"'`,;)]*/g, '[path]')
    .replace(/(?:\/(?:home|Users|root)\/)\S*/g, '[path]')
    .slice(0, max)
}

/** Map a host synthesis failure onto the contract's error codes. */
export function speakSynthesisErrorCode(error: unknown, aborted = false): 'cancelled' | 'timeout' | 'auth' | 'quota' | 'network' | 'failed' {
  if (aborted) return 'cancelled'
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  // Belt-and-braces: a wrapper error that kept an abort message (but lost
  // the name) still reads as timeout, not network.
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message === 'string' && /\babort|timed? ?out\b/i.test(message)) return 'timeout'
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status !== 'number') return 'network'
  if (status === 401 || status === 403) return 'auth'
  if (status === 402 || status === 429) return 'quota'
  if (status === 0) return 'network'
  return 'failed'
}

/** Best-effort delete of expired speak files; never throws. */
export function cleanupSpeakFiles(dir: string, ttlMs: number, now = Date.now()): void {
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('speak-') || !name.includes('.')) continue
      const file = join(dir, name)
      try {
        if (now - statSync(file).mtimeMs > ttlMs) rmSync(file, { force: true })
      } catch {
        // a single unremovable file must not fail the tool
      }
    }
  } catch {
    // directory absent is normal before the first synthesis
  }
}

/** Short user-visible render line: no spoken content, no "voice sent" narration. */
function renderSpeakResult(value: unknown): TextContentBlock[] {
  const v = value as { chars: number; format: string; delivered: boolean; channel?: string }
  const delivered = v.delivered ? ` · delivered${v.channel !== undefined ? ` (${v.channel})` : ''}` : ' · not delivered'
  return [{ type: 'text', text: `${SPEAK_TOOL_NAME}: ${v.chars} chars · ${v.format}${delivered}` }]
}

/** Thrown by the delivery race when the channel hook exceeds its ceiling.
 * Distinguishes "delivery may still complete channel-side" (keep the file)
 * from a clean channel rejection (delete the file). */
class DeliveryTimeoutError extends Error {
  constructor(ceilingMs: number) {
    super(`delivery timed out after ${Math.round(ceilingMs / 1000)}s`)
    this.name = 'DeliveryTimeoutError'
  }
}

/** Build the model-facing tool definition. Registration and lifecycle are the
 * host's job (see apply in index.ts); this factory only closes over deps. */
export function createSpeakTool(deps: SpeakToolDeps): Record<string, unknown> {
  const description = [
    'Speak a short speech line as a voice bubble in the current chat channel (Fish Audio TTS).',
    'The text is spoken as-is: pass the utterance itself, not a chat message.',
    'Allowed English half-width bracket tags:',
    'emotion [angry] [sad] [embarrassed] [emphasis] [whispering] [soft] [breathy] [excited];',
    'sound [laughing] [chuckling] [sighing] [sobbing] [crying loudly] [panting] [groaning] [moaning] [clear throat] [pause] [long pause] [crowd laughing] [background laughter] [audience laughing].',
    'Never invent tags and never explain them; do not use emoji, markdown, links, lists or code.',
    'Only use it when the user explicitly asks for voice, or when a very short spoken reply is clearly better than text.',
    'Hard limit: at most a few voices per minute per conversation — when the limit is hit the tool fails with the remaining seconds, so fall back to a text reply instead of retrying.',
    `Write 1-2 short spoken sentences under ~300 characters, in the user's language; spell numbers and abbreviations out in words where natural.`,
    'After sending, keep the text reply to at most one short line and do NOT repeat the spoken content or narrate "voice sent".',
  ].join(' ')

  return {
    name: SPEAK_TOOL_NAME,
    description,
    timeoutMs: SPEAK_TIMEOUT_MS,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The words to speak. Fish bracket tags and Chinese-parenthesis asides pass through verbatim; markdown/code/links are stripped before synthesis.',
        },
        voice: {
          type: 'string',
          description: 'Optional saved-voice name or id, or a raw Fish Audio reference_id. Omit to use the default voice.',
        },
        format: {
          type: 'string',
          enum: ['mp3', 'wav', 'opus'],
          description: 'Optional audio format. Omit to use the configured default (mp3).',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          bytes: { type: 'integer' },
          chars: { type: 'integer' },
          format: { type: 'string' },
          mime: { type: 'string' },
          delivered: { type: 'boolean' },
          channel: { type: 'string' },
          fileName: { type: 'string' },
          voice: { type: 'string' },
        },
        required: ['bytes', 'chars', 'format', 'mime', 'delivered'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): TextContentBlock[] => renderSpeakResult(value),
    },
    async execute(args: unknown, exec: SpeakExec = {}): Promise<Record<string, unknown>> {
      const now = deps.now ?? Date.now
      const cfg = deps.settings()
      if (!cfg.enabled) {
        throw speakError('disabled', 'the speech tool is turned off in the Fish TTS settings')
      }
      if (cfg.perMinute <= 0) {
        throw speakError('rate-limited', 'voice sending is disabled (per-minute limit is 0) — reply with text instead')
      }
      if (!deps.hasApiKey()) {
        throw speakError('auth', 'no Fish Audio API key is configured — set it in the Fish TTS plugin settings')
      }

      const raw = (args as SpeakArgs | undefined)?.text
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw speakError('failed', '`text` must be a non-empty string')
      }
      const text = dropUnknownTags(cleanSpeechText(raw))
      if (text === '') {
        throw speakError('text-empty', 'the text has no speakable content (only code, links or symbols)')
      }
      if (text.length > cfg.maxChars) {
        throw speakError('text-too-long', `the line is ${text.length} chars, over the ${cfg.maxChars}-char limit — shorten it or reply with text`)
      }
      const voice = resolveSpeakVoice((args as SpeakArgs).voice, deps.savedVoices(), deps.defaultVoice())
      if (voice === null) {
        throw speakError('voice-not-configured', 'no default voice is configured — set one in the Fish TTS plugin settings')
      }
      const requestedFormat = (args as SpeakArgs).format
      const format = typeof requestedFormat === 'string' && SPEAK_FORMATS.has(requestedFormat)
        ? requestedFormat
        : cfg.format
      const mime = SPEAK_MIME[format] ?? 'audio/mpeg'

      // Session key: harness session id when available, one shared bucket otherwise.
      const agent = exec.agent
      const sessionId = (agent as { session?: { id?: unknown } } | null | undefined)?.session?.id
      const sessionKey = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'default'

      // Claim the send slot BEFORE synthesizing so the seconds-long synthesis
      // window cannot be raced by a parallel call in the same conversation.
      const intervalMs = Math.ceil(60_000 / cfg.perMinute)
      const slot = deps.limiter.tryAcquire(sessionKey, intervalMs, now())
      if (!slot.ok) {
        throw speakError('rate-limited', `a voice was sent too recently in this conversation — wait ${slot.retryAfterSec}s or reply with text`)
      }

      let audio: Buffer
      try {
        audio = await deps.synthesize({
          text,
          voice: voice.voice,
          model: deps.model(),
          format,
          volumeDb: cfg.volumeDb,
          loudness: cfg.loudness,
          signal: exec.signal,
        })
      } catch (error) {
        deps.limiter.release(sessionKey, slot.token)
        const code = speakSynthesisErrorCode(error, exec.signal?.aborted === true)
        const detail = sanitizeErrorDetail(error instanceof Error ? error.message : String(error))
        throw speakError(code, `synthesis failed — ${detail}`)
      }

      // Absurdly large audio is rejected before it ever touches the disk.
      if (audio.length > SPEAK_MAX_FILE_BYTES) {
        deps.limiter.release(sessionKey, slot.token)
        throw speakError('failed', `the synthesized clip is ${audio.length} bytes, over the ${SPEAK_MAX_FILE_BYTES}-byte cap — shorten the line`)
      }

      // Cancelled during synthesis: nothing may be delivered.
      if (exec.signal?.aborted === true) {
        deps.limiter.release(sessionKey, slot.token)
        throw speakError('cancelled', 'the turn was cancelled before delivery')
      }

      const outDir = deps.outDir()
      const fileName = `speak-${now().toString(36)}-${randomUUID().slice(0, 8)}.${format}`
      const audioPath = join(outDir, fileName)
      try {
        mkdirSync(outDir, { recursive: true })
        writeFileSync(audioPath, audio)
      } catch (error) {
        deps.limiter.release(sessionKey, slot.token)
        const detail = sanitizeErrorDetail(error instanceof Error ? error.message : String(error))
        throw speakError('failed', `could not write the audio file — ${detail}`)
      }

      const claimed = deps.deliveries.find(sessionKey, agent)
      if (claimed !== undefined) {
        try {
          // Hard ceiling: a channel that never settles must not pin the
          // exclusive tool pipeline (the harness does not enforce timeoutMs).
          const deliverCeiling = deps.deliverTimeoutMs ?? SPEAK_DELIVER_TIMEOUT_MS
          await Promise.race([
            claimed.delivery.deliver({ audioPath, mime, text, sessionId: sessionKey, agent, signal: exec.signal }),
            new Promise<never>((_, reject) => {
              const timer = setTimeout(() => reject(new DeliveryTimeoutError(deliverCeiling)), deliverCeiling)
              // Do not hold the event loop open for the rejection timer alone.
              timer.unref?.()
            }),
          ])
          // Delivered: the channel has consumed the file — free it now
          // instead of letting it linger for the TTL.
          try { rmSync(audioPath, { force: true }) } catch { /* best effort */ }
        } catch (error) {
          if (!(error instanceof DeliveryTimeoutError)) {
            // Clean channel rejection (filter hit, unresolved target, send
            // failure): nothing was sent, so the file must not linger.
            try { rmSync(audioPath, { force: true }) } catch { /* best effort */ }
          }
          // A timed-out delivery may still complete channel-side, so that
          // file is intentionally left in place for the TTL sweep.
          deps.limiter.release(sessionKey, slot.token)
          const detail = sanitizeErrorDetail(error instanceof Error ? error.message : String(error))
          throw speakError('voice-rejected', `the channel rejected the voice — ${detail}`)
        }
      }

      cleanupSpeakFiles(outDir, SPEAK_FILE_TTL_MS, now())
      deps.log(`${SPEAK_TOOL_NAME} ${audio.length}B ${text.length}ch ${format} delivered=${claimed !== undefined}${claimed !== undefined ? ` channel=${claimed.channel}` : ''} session=${sessionKey}`)

      return {
        bytes: audio.length,
        chars: text.length,
        format,
        mime,
        delivered: claimed !== undefined,
        ...(claimed !== undefined ? { channel: claimed.channel } : { fileName }),
        ...(voice.from === 'default' ? {} : { voice: voice.voice }),
      }
    },
  }
}

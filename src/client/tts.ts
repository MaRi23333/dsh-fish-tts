/**
 * Browser-side synthesis pipeline: strip markdown artifacts, POST to the host
 * route, play the returned audio through an <audio> element (user-gesture or
 * explicit auto-play opt-in), and stop/replace any currently playing clip.
 */
import type { SavedVoice } from '../voices.ts'

export interface TtsStatus {
  ok: boolean
  model?: string
  voice?: string
  format?: string
  keyConfigured?: boolean
  cacheEntries?: number
  error?: string
  message?: string
}

/** Editable config surface (the API key itself never crosses this boundary). */
export interface TtsConfig {
  ok: boolean
  model: string
  voice: string
  format: string
  proxy: string
  keyConfigured: boolean
  hasStoredKey: boolean
  savedVoices: SavedVoice[]
  stateDir?: string
  error?: string
  message?: string
}

/** Browser-local playback volume (0..1), default quieter than full blast. */
const VOLUME_KEY = 'fish-tts.volume'
const DEFAULT_VOLUME = 0.6

export function getVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY)
    if (raw === null) return DEFAULT_VOLUME
    const value = Number(raw)
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

export function setVolume(value: number): void {
  try {
    const clamped = Math.min(1, Math.max(0, value))
    window.localStorage.setItem(VOLUME_KEY, String(clamped))
  } catch {
    // storage write failed: the preference is not persisted and the next
    // clip keeps the previously stored value
  }
}

/** Browser-local playback speed (0.5..2.0), applied per new clip. */
const SPEED_KEY = 'fish-tts.speed'
const DEFAULT_SPEED = 1
const MIN_SPEED = 0.5
const MAX_SPEED = 2

/**
 * Whether pitch-preserving rate control is available. Modern browsers all
 * ship `preservesPitch` (defaulting to true); where it is missing the
 * settings row is disabled and playback stays at 1x rather than chipmunking.
 */
export function speedSupported(): boolean {
  try {
    return typeof HTMLAudioElement !== 'undefined'
      && 'playbackRate' in HTMLAudioElement.prototype
      && 'preservesPitch' in HTMLAudioElement.prototype
  } catch {
    return false
  }
}

export function getSpeed(): number {
  try {
    const raw = window.localStorage.getItem(SPEED_KEY)
    if (raw === null || raw.trim() === '') return DEFAULT_SPEED
    const value = Number(raw)
    // setSpeed only ever stores in-range values; anything else (non-numeric,
    // empty, out of range) is corruption or manual tampering — fall back to 1x.
    if (!Number.isFinite(value) || value < MIN_SPEED || value > MAX_SPEED) return DEFAULT_SPEED
    return value
  } catch {
    return DEFAULT_SPEED
  }
}

export function setSpeed(value: number): void {
  try {
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value))
    window.localStorage.setItem(SPEED_KEY, String(clamped))
  } catch {
    // storage write failed: the preference is not persisted and the next
    // clip keeps the previously stored value
  }
}

/**
 * Apply the stored playback rate to a fresh clip. Pitch preservation is
 * requested explicitly; where the browser lacks it the rate stays at the
 * default 1x rather than chipmunking.
 */
export function applySpeed(audio: HTMLAudioElement): void {
  if (!speedSupported()) return
  audio.preservesPitch = true
  // defaultPlaybackRate covers UAs that reset the live rate when the source
  // metadata loads; playbackRate is what play() actually uses.
  const speed = getSpeed()
  audio.defaultPlaybackRate = speed
  audio.playbackRate = speed
}

/** Spoken placeholder words for un-speakable tokens, per locale. */
export interface TtsReplacements {
  link: string
  path: string
  id: string
  code: string
  codeBlock: string
}

export const REPL_EN: TtsReplacements = Object.freeze({
  link: 'link', path: 'path', id: 'id', code: 'code', codeBlock: 'code block omitted',
})

export const REPL_ZH: TtsReplacements = Object.freeze({
  link: '链接', path: '路径', id: '编号', code: '长代码', codeBlock: '代码块，已省略',
})

/** Strip markdown syntax that does not belong in spoken audio. */
export function cleanForTts(text: string, repl: TtsReplacements = REPL_EN): string {
  return text
    // technical tokens that should never be spoken: bare URLs, Windows/Unix
    // paths, UUIDs and long hex ids, and long random tokens (keys, base64).
    .replace(/https?:\/\/[^\s<>"|]+/g, repl.link)
    .replace(/[A-Za-z]:\\[^\s<>"|]+/g, repl.path)
    .replace(/(^|[\s(（])(?:~\/|\.{0,2}\/)[^\s<>"|]+/g, `$1${repl.path}`)
    .replace(/\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/g, repl.id)
    .replace(/\b[0-9a-fA-F]{16,}\b/g, repl.id)
    .replace(/[A-Za-z0-9+/=_-]{24,}/g, repl.code)
    // code fences and inline code
    .replace(/```[\s\S]*?```/g, ` ${repl.codeBlock} `)
    .replace(/`([^`\n]+)`/g, '$1')
    // images entirely; links keep their label
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // headings, blockquote, list markers, horizontal rules, html tags
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/<[^>]+>/g, ' ')
    // emphasis markers and excessive whitespace
    .replace(/(\*\*|__|~~|\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export class FishTtsPlayer {
  private current: HTMLAudioElement | null = null
  private currentUrl: string | null = null
  private currentOwner: string | null = null
  private pendingOwner: string | null = null
  private request: AbortController | null = null
  private readonly listeners = new Set<() => void>()
  /** Generation counter; stop() and each play() bump it to invalidate
   *  in-flight synthesis, so a superseded fetch result never starts audio. */
  private playToken = 0

  /** Pause the current clip and release its blob URL (no token bump). */
  private halt(): void {
    if (this.current !== null) {
      this.current.pause()
      this.current = null
    }
    if (this.currentUrl !== null) {
      URL.revokeObjectURL(this.currentUrl)
      this.currentUrl = null
    }
    this.currentOwner = null
  }

  /** Notify controls immediately, without per-message polling. */
  private notify(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* one subscriber cannot interrupt playback */ }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stop whatever is playing and cancel any in-flight synthesis. */
  stop(): void {
    this.playToken += 1
    this.request?.abort()
    this.request = null
    this.pendingOwner = null
    this.halt()
    this.notify()
  }

  stopFor(owner: string): void {
    if (this.currentOwner === owner || this.pendingOwner === owner) this.stop()
  }

  get playing(): boolean {
    return this.current !== null && !this.current.paused && !this.current.ended
  }

  /** Owners identify messages, even when two messages contain identical text. */
  playingFor(owner: string): boolean {
    return this.playing && this.currentOwner === owner
  }

  pendingFor(owner: string): boolean {
    return this.pendingOwner === owner
  }

  /**
   * Synthesize and play one text.
   * @param text - raw markdown text of the reply (cleaned internally).
   * @param repl - spoken placeholder words for the active locale.
   * @param owner - message identity, or an independent owner for a test clip.
   */
  async play(text: string, repl: TtsReplacements = REPL_EN, owner: string = text): Promise<void> {
    const cleaned = cleanForTts(text, repl)
    if (cleaned === '') return
    const token = ++this.playToken
    this.request?.abort()
    this.halt()
    const request = new AbortController()
    this.request = request
    this.pendingOwner = owner
    this.notify()
    try {
      const response = await fetch('/fish-tts/synthesize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: cleaned }),
        signal: request.signal,
      })
      if (token !== this.playToken) return
      if (!response.ok) {
        let message = response.statusText
        let code = 'synthesis-failed'
        try {
          const payload = await response.json() as { message?: string; error?: string }
          message = payload.message ?? payload.error ?? message
          if (payload.error !== undefined) code = payload.error
        } catch {
          // non-JSON error body
        }
        const error = new Error(message) as Error & { code?: string }
        error.code = code
        throw error
      }
      const blob = await response.blob()
      // A stop() or a newer play() arrived while synthesizing: discard silently.
      if (token !== this.playToken) return
      const url = URL.createObjectURL(blob)
      this.currentUrl = url
      const audio = new Audio(url)
      audio.volume = getVolume()
      applySpeed(audio)
      this.current = audio
      this.currentOwner = owner
      const finished = (): void => {
        if (this.current === audio) {
          this.halt()
          this.notify()
        }
      }
      audio.addEventListener('ended', finished, { once: true })
      audio.addEventListener('error', finished, { once: true })
      await audio.play()
    } catch (error) {
      // Explicit cancellation and a newer request are expected outcomes.
      if (token !== this.playToken || request.signal.aborted) return
      this.halt()
      throw error
    } finally {
      if (token === this.playToken) {
        this.request = null
        this.pendingOwner = null
        this.notify()
      }
    }
  }

  /** Fetch the host status card. */
  async status(): Promise<TtsStatus> {
    try {
      const response = await fetch('/fish-tts/status', { cache: 'no-store' })
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
      return await response.json() as TtsStatus
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'status fetch failed' }
    }
  }

  /** Fetch the editable config (never includes the key). */
  async config(): Promise<TtsConfig> {
    try {
      const response = await fetch('/fish-tts/config', { cache: 'no-store' })
      if (!response.ok) return { ok: false, model: '', voice: '', format: 'wav', proxy: '', keyConfigured: false, hasStoredKey: false, savedVoices: [], error: `HTTP ${response.status}` }
      const payload = await response.json() as TtsConfig
      return { ...payload, savedVoices: payload.savedVoices ?? [] }
    } catch (error) {
      return { ok: false, model: '', voice: '', format: 'wav', proxy: '', keyConfigured: false, hasStoredKey: false, savedVoices: [], error: error instanceof Error ? error.message : 'config fetch failed' }
    }
  }

  /** Persist an edit patch; empty strings clear, undefined keeps. */
  async saveConfig(patch: {
    model?: string
    voice?: string
    format?: string
    proxy?: string
    apiKey?: string
    clearKey?: boolean
    savedVoices?: SavedVoice[]
  }): Promise<TtsConfig> {
    try {
      const response = await fetch('/fish-tts/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const payload = await response.json() as (TtsConfig & { message?: string })
      if (!response.ok || payload.ok !== true) {
        return { ok: false, model: '', voice: '', format: 'wav', proxy: '', keyConfigured: false, hasStoredKey: false, savedVoices: [], error: payload.message ?? payload.error ?? `HTTP ${response.status}` }
      }
      return { ...payload, savedVoices: payload.savedVoices ?? [] }
    } catch (error) {
      return { ok: false, model: '', voice: '', format: 'wav', proxy: '', keyConfigured: false, hasStoredKey: false, savedVoices: [], error: error instanceof Error ? error.message : 'config save failed' }
    }
  }

  /** Fetch selectable TTS model ids (live API list with curated fallback). */
  async models(): Promise<string[]> {
    try {
      const response = await fetch('/fish-tts/models', { cache: 'no-store' })
      if (!response.ok) return []
      const payload = await response.json() as { models?: string[] }
      return Array.isArray(payload.models) ? payload.models : []
    } catch {
      return []
    }
  }
}

/**
 * dsh-plugin-fish-tts — browser half.
 *
 * 1. A "朗读" entry in the assistant-message action strip
 *    (slot `conversation.chat.assistant-actions`), with opt-in auto-play of
 *    replies that arrived after this page loaded.
 * 2. An always-visible auto-read toggle in the composer tool row
 *    (slot `conversation.input.left`).
 * 3. A settings section (`settings.section`) showing model/voice/key status,
 *    a test clip, and the same auto-play toggle.
 *
 * Audio synthesis happens on the host through the plugin's own web routes;
 * the browser only fetches and plays the returned audio.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { FishTtsPlayer, getVolume, setVolume, REPL_EN, REPL_ZH, type TtsReplacements } from './tts.ts'
import { FishTtsActions, type FishTtsActionInjected } from './FishTtsActions.tsx'
import { FishTtsInputToggle, type FishTtsInputToggleInjected } from './FishTtsInputToggle.tsx'
import { FishTtsSettings, type FishTtsSettingsInjected } from './FishTtsSettings.tsx'
import { en, zh } from './locales.ts'

const NS = 'fish-tts'
const STORAGE_KEY = 'fish-tts.autoplay'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const player = new FishTtsPlayer()
  const loadTime = Date.now()
  // MessageId is branded; the set only ever holds ids read back from the owner.
  const played = new Set<string>() as Set<MessageId>

  // ── dictionaries (typed namespace declared in locales.ts) ────────────────
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fish-tts: dictionaries')

  // ── auto-play preference (browser-local, shared across all UI surfaces) ──
  const autoPlayListeners = new Set<() => void>()
  const autoPlayEnabled = (): boolean => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  }
  const setAutoPlay = (enabled: boolean): void => {
    try {
      if (enabled) window.localStorage.setItem(STORAGE_KEY, '1')
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // storage unavailable; toggle stays session-local
    }
    for (const listener of autoPlayListeners) {
      try {
        listener()
      } catch {
        // one stale subscriber must not break the others
      }
    }
  }
  const subscribeAutoPlay = (fn: () => void): (() => void) => {
    autoPlayListeners.add(fn)
    return () => { autoPlayListeners.delete(fn) }
  }

  // ── composer tool-row toggle ─────────────────────────────────────────────
  ctx.slots.inject('conversation.input.left', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.left',
      id: NS,
      order: 30,
      locale: NS,
      inject: (): FishTtsInputToggleInjected => ({
        autoPlayEnabled,
        setAutoPlay,
        subscribeAutoPlay,
      }),
    }, FishTtsInputToggle)
    return dispose
  })

  // ── assistant-message action strip ───────────────────────────────────────
  const replacements = (): TtsReplacements =>
    ctx.locale.getLocale().active === 'zh' ? REPL_ZH : REPL_EN
  ctx.slots.inject('conversation.chat.assistant-actions', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: NS,
      order: 20,
      locale: NS,
      inject: (): FishTtsActionInjected => ({
        play: text => player.play(text, replacements()),
        playing: () => player.playing,
        autoPlayEnabled,
        loadTime,
        played,
      }),
    }, FishTtsActions)
    return () => {
      dispose()
      player.stop()
    }
  })

  // ── settings section (re-registered on locale change for the nav label) ──
  let disposeSection: (() => void) | null = null
  const mountSection = (): void => {
    if (disposeSection !== null) {
      disposeSection()
      disposeSection = null
    }
    const t = ctx.locale.bind(NS)
    const sample = ctx.locale.getLocale().active === 'zh'
      ? '你好，这是 Fish Audio 语音朗读测试。模型与音色均已按你的配置就绪。'
      : 'Hello, this is a Fish Audio read-aloud test. The configured model and voice are ready.'
    disposeSection = ctx.slots.register({
      name: 'settings.section',
      id: NS,
      order: 50,
      label: () => t('settings.label'),
      inject: (): FishTtsSettingsInjected => ({
        t,
        test: () => player.play(sample, replacements()),
        playing: () => player.playing,
        autoPlay: autoPlayEnabled,
        setAutoPlay,
        subscribeAutoPlay,
        volume: getVolume,
        setVolume,
        config: () => player.config(),
        saveConfig: patch => player.saveConfig(patch),
        models: () => player.models(),
      }),
    }, FishTtsSettings)
  }

  ctx.slots.inject('settings.section', () => {
    mountSection()
    const onLocale = ctx.on('locale/change', () => { mountSection() })
    return () => {
      onLocale()
      if (disposeSection !== null) {
        disposeSection()
        disposeSection = null
      }
    }
  })

  ctx.effect(() => () => {
    player.stop()
  }, 'fish-tts: stop audio on unload')
}

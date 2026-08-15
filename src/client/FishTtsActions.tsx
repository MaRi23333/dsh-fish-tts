/**
 * Per-message "朗读" entry in the assistant-message action strip.
 * Owner supplies the finalized messageId; the session standard kit supplies
 * useSession, through which the message text and the "latest message" bit are
 * derived from the live ConversationSnapshot. Selectors return primitives only
 * (string/boolean/number) because uSES requires value-stable selections.
 */
import { useEffect, useRef, useState } from 'react'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SpeakerIcon } from './icons.tsx'
import type { FishTtsKey } from './locales.ts'

export interface FishTtsActionInjected {
  /** Synthesize and play one reply text. */
  play: (text: string) => Promise<void>
  /** Whether audio is currently playing. */
  playing: () => boolean
  /** Whether auto-play of new replies is enabled. */
  autoPlayEnabled: () => boolean
  /** Page-load timestamp used to fence auto-play to genuinely new replies. */
  loadTime: number
  /** Set of message ids this page load has already auto-played. */
  played: Set<MessageId>
}

export type FishTtsActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<FishTtsActionInjected>
  & PropsLocale<'fish-tts'>

/** Legacy node shape as projected on the conversation snapshot. */
interface AssistantLike {
  kind?: string
  messageId?: MessageId
  turn?: number
  step?: number
  seq?: number
  time?: number
  blocks?: readonly { kind?: string; text?: string }[]
}

/** Text of the finalized assistant message addressed by the owner. */
function selectText(snapshot: { nodes: readonly unknown[] }, messageId: MessageId): string {
  for (const raw of snapshot.nodes) {
    const node = raw as AssistantLike
    if (node.kind !== 'assistant' || node.messageId !== messageId) continue
    return (node.blocks ?? [])
      .filter(block => block.kind === 'text' && typeof block.text === 'string')
      .map(block => (block as { text: string }).text)
      .join('\n')
  }
  return ''
}

/** Whether the addressed message is the latest finalized assistant message. */
function selectIsLatest(snapshot: { nodes: readonly unknown[] }, messageId: MessageId): boolean {
  let latest: { turn: number; step: number; seq: number; messageId: MessageId | undefined } | null = null
  for (const raw of snapshot.nodes) {
    const node = raw as AssistantLike
    if (node.kind !== 'assistant' || node.messageId === undefined) continue
    const order = { turn: node.turn ?? 0, step: node.step ?? 0, seq: node.seq ?? 0 }
    const better = latest === null
      || order.turn > latest.turn
      || (order.turn === latest.turn && order.step > latest.step)
      || (order.turn === latest.turn && order.step === latest.step && order.seq > latest.seq)
    if (better) latest = { ...order, messageId: node.messageId }
  }
  return latest !== null && latest.messageId === messageId
}

/** Finalized timestamp of the addressed message (0 when not found). */
function selectTime(snapshot: { nodes: readonly unknown[] }, messageId: MessageId): number {
  for (const raw of snapshot.nodes) {
    const node = raw as AssistantLike
    if (node.kind === 'assistant' && node.messageId === messageId) return node.time ?? 0
  }
  return 0
}

export function FishTtsActions(props: FishTtsActionProps): React.ReactElement | null {
  const { messageId, useSession, play, playing, autoPlayEnabled, loadTime, played, t } = props
  const text = useSession(snapshot => selectText(snapshot as never, messageId))
  const isLatest = useSession(snapshot => selectIsLatest(snapshot as never, messageId))
  const time = useSession(snapshot => selectTime(snapshot as never, messageId))

  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    const tick = (): void => { if (alive.current) setIsPlaying(playing()) }
    tick()
    const timer = window.setInterval(tick, 400)
    return () => { window.clearInterval(timer) }
  }, [playing])

  // Auto-play: only for the latest finalized reply, only when it arrived after
  // this page loaded, and only once per message id.
  useEffect(() => {
    if (!autoPlayEnabled()) return
    if (!isLatest || text.trim() === '' || time <= loadTime) return
    if (played.has(messageId)) return
    played.add(messageId)
    void play(text).catch(() => { played.delete(messageId) })
  }, [isLatest, text, time, messageId, play, autoPlayEnabled, loadTime, played])

  if (text.trim() === '') return null

  const onSpeak = (): void => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    void play(text).then(
      () => { if (alive.current) setBusy(false) },
      (error: Error & { code?: string }) => {
        if (!alive.current) return
        setBusy(false)
        setFailure(error.code === 'voice-required' ? t('error.voiceRequired') : t('action.failed'))
      },
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('action.speak.aria')}
        data-active={isPlaying || undefined}
        title={failure ?? t('action.speak')}
        disabled={busy}
        onClick={onSpeak}
        style={{
          background: 'none',
          border: 'none',
          padding: '0 2px',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.55 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          color: failure !== null ? 'var(--dsh-color-danger, #e5484d)' : 'inherit',
        }}
      >
        <SpeakerIcon playing={isPlaying} />
      </button>
    </>
  )
}

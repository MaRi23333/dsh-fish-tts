/**
 * Per-message "朗读" entry in the assistant-message action strip.
 * Owner supplies the finalized messageId; the chat session kit supplies
 * useChat, through which the message text and the "latest message" bit are
 * derived from the live ChatSnapshot (legacy nodes projection keeps the
 * pre-0.1.2 ConversationSnapshot field semantics for text/order/timing).
 * Selectors return primitives only (string/boolean/number) because uSES
 * requires value-stable selections.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SpeakerIcon } from './icons.tsx'
import type { FishTtsKey } from './locales.ts'

export interface FishTtsActionInjected {
  /** Synthesize and play one reply text. */
  play: (text: string, owner: string) => Promise<void>
  /** Stop whatever is playing and cancel any in-flight synthesis. */
  stop: (owner: string) => void
  /** Message identity separates even identical source texts. */
  playingFor: (owner: string) => boolean
  pendingFor: (owner: string) => boolean
  subscribePlayer: (listener: () => void) => () => void
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
  const { messageId, useChat, play, stop, playingFor, pendingFor, subscribePlayer, autoPlayEnabled, loadTime, played, t } = props
  // The chat session kit injects useChat (SnapshotSelectorHook<ChatSnapshot>);
  // its legacy projection keeps the pre-0.1.2 ConversationSnapshot.node shape,
  // so the text/order/timing selectors below stay unchanged. Every selector
  // returns a primitive for uSES value-stable selection.
  const text = useChat(s => selectText({ nodes: s.legacy.nodes }, messageId))
  const isLatest = useChat(s => selectIsLatest({ nodes: s.legacy.nodes }, messageId))
  const time = useChat(s => selectTime({ nodes: s.legacy.nodes }, messageId))

  const [failure, setFailure] = useState<string | null>(null)
  const busy = useSyncExternalStore(subscribePlayer, () => pendingFor(messageId), () => false)
  const isPlaying = useSyncExternalStore(subscribePlayer, () => playingFor(messageId), () => false)
  const alive = useRef(true)
  const operation = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // Auto-play: only for the latest finalized reply, only when it arrived after
  // this page loaded, and only once per message id.
  useEffect(() => {
    if (!autoPlayEnabled()) return
    if (!isLatest || text.trim() === '' || time <= loadTime) return
    if (played.has(messageId)) return
    played.add(messageId)
    void play(text, messageId).catch(() => { played.delete(messageId) })
  }, [isLatest, text, time, messageId, play, autoPlayEnabled, loadTime, played])

  if (text.trim() === '') return null

  const onSpeak = (): void => {
    const token = ++operation.current
    if (pendingFor(messageId) || playingFor(messageId)) {
      stop(messageId)
      setFailure(null)
      return
    }
    setFailure(null)
    void play(text, messageId).catch(
      (error: Error & { code?: string }) => {
        if (!alive.current || token !== operation.current) return
        setFailure(error.code === 'voice-required' ? t('error.voiceRequired') : t('action.failed'))
      },
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label={isPlaying || busy ? t('action.stop') : t('action.speak.aria')}
        data-active={isPlaying || undefined}
        title={failure ?? (isPlaying || busy ? t('action.stop') : t('action.speak'))}
        onClick={onSpeak}
        style={{
          background: 'none',
          border: 'none',
          padding: '0 2px',
          cursor: 'pointer',
          opacity: busy ? 0.55 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          // Follow the current assistant action-strip token, retaining the
          // previous neutral grey as a fallback for hosts that omit it.
          color: failure !== null
            ? 'var(--dsh-color-danger, #e5484d)'
            : 'var(--dsw-alias-label-tertiary, #7a7a7a)',
        }}
      >
        <SpeakerIcon playing={isPlaying || busy} />
      </button>
    </>
  )
}

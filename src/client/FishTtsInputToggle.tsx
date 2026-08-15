/**
 * Always-visible auto-read toggle in the composer tool row
 * (slot `conversation.input.left`). Shares the same browser-local preference
 * and live sync channel as the settings section toggle.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SpeakerIcon } from './icons.tsx'
import type { FishTtsKey } from './locales.ts'

export interface FishTtsInputToggleInjected {
  autoPlayEnabled: () => boolean
  setAutoPlay: (enabled: boolean) => void
  subscribeAutoPlay: (fn: () => void) => () => void
}

export type FishTtsInputToggleProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<FishTtsInputToggleInjected>
  & PropsLocale<'fish-tts'>

export function FishTtsInputToggle(props: FishTtsInputToggleProps): React.ReactElement {
  const { autoPlayEnabled, setAutoPlay, subscribeAutoPlay, t } = props
  const [enabled, setEnabled] = useState(autoPlayEnabled())
  useEffect(() => subscribeAutoPlay(() => { setEnabled(autoPlayEnabled()) }), [subscribeAutoPlay, autoPlayEnabled])

  const toggle = (): void => {
    setAutoPlay(!enabled)
  }

  return (
    <button
      type="button"
      aria-label={t('input.toggle')}
      aria-pressed={enabled}
      data-active={enabled || undefined}
      title={enabled ? t('input.toggle.on') : t('input.toggle.off')}
      onClick={toggle}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '2px 3px',
        display: 'inline-flex',
        alignItems: 'center',
        color: enabled ? 'var(--dsh-color-primary, #4d6bfe)' : 'inherit',
        opacity: enabled ? 1 : 0.55,
      }}
    >
      <SpeakerIcon muted={!enabled} />
    </button>
  )
}

/**
 * Settings section: editable model / voice / API key / proxy (persisted
 * encrypted on the host), a test clip, the auto-play preference, and volume.
 * The API key travels only into the PUT body and never comes back.
 */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FishTtsKey } from './locales.ts'
import type { TtsConfig } from './tts.ts'

export interface FishTtsSettingsInjected {
  t: (key: FishTtsKey) => string
  test: () => Promise<void>
  playing: () => boolean
  autoPlay: () => boolean
  setAutoPlay: (enabled: boolean) => void
  subscribeAutoPlay: (fn: () => void) => () => void
  volume: () => number
  setVolume: (value: number) => void
  speed: () => number
  setSpeed: (value: number) => void
  speedSupported: () => boolean
  config: () => Promise<TtsConfig>
  saveConfig: (patch: {
    model?: string
    voice?: string
    format?: string
    proxy?: string
    apiKey?: string
    clearKey?: boolean
  }) => Promise<TtsConfig>
  models: () => Promise<string[]>
}

export type FishTtsSettingsProps =
  PropsRuntime<'settings.section'>
  & InjectFace<FishTtsSettingsInjected>

export function FishTtsSettings(props: FishTtsSettingsProps): React.ReactElement {
  const { t, test, playing, autoPlay, setAutoPlay, subscribeAutoPlay, volume, setVolume, speed, setSpeed, speedSupported, config, saveConfig, models } = props

  const [model, setModel] = useState('')
  const [voice, setVoice] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [proxy, setProxy] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [keyStatus, setKeyStatus] = useState<'unknown' | 'ok' | 'missing'>('unknown')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(autoPlay())
  const [vol, setVol] = useState(volume())
  const [spd, setSpd] = useState(speed())
  const speedOk = speedSupported()
  const [testing, setTesting] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => subscribeAutoPlay(() => { setEnabled(autoPlay()) }), [subscribeAutoPlay, autoPlay])

  useEffect(() => {
    void config().then((result) => {
      if (!alive.current) return
      setModel(result.model)
      setVoice(result.voice)
      setProxy(result.proxy)
      setKeyStatus(result.keyConfigured ? 'ok' : 'missing')
    })
    void models().then((ids) => {
      if (alive.current) setModelOptions(ids)
    })
  }, [config, models])

  const onSave = (): void => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    const patch: Parameters<FishTtsSettingsInjected['saveConfig']>[0] = {
      model,
      voice,
      proxy,
    }
    if (apiKey.trim() !== '') patch.apiKey = apiKey.trim()
    void saveConfig(patch).then((result) => {
      if (!alive.current) return
      setSaving(false)
      if (result.ok) {
        setSavedAt(Date.now())
        setApiKey('')
        setModel(result.model)
        setVoice(result.voice)
        setProxy(result.proxy)
        setKeyStatus(result.keyConfigured ? 'ok' : 'missing')
      } else {
        setSaveError(result.error ?? t('settings.saveFailed'))
      }
    })
  }

  const onClearKey = (): void => {
    void saveConfig({ clearKey: true }).then((result) => {
      if (alive.current && result.ok) setKeyStatus('missing')
    })
  }

  const onTest = (): void => {
    if (testing) return
    setTesting(true)
    void test().finally(() => { if (alive.current) setTesting(false) })
  }

  const onToggle = (): void => {
    const next = !enabled
    setEnabled(next)
    setAutoPlay(next)
  }

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '8px 0',
  } as const
  const labelStyle = { fontSize: '13px', opacity: 0.85, minWidth: '96px' } as const
  const inputStyle = {
    flex: 1,
    fontSize: '13px',
    fontFamily: 'monospace',
    padding: '4px 8px',
    border: '1px solid var(--dsh-color-border, #3a3f4b)',
    borderRadius: '4px',
    background: 'transparent',
    color: 'inherit',
  } as const
  const hintStyle = { fontSize: '11px', opacity: 0.6, marginTop: '2px' } as const

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 4px' }}>
      <div style={{ fontSize: '15px', fontWeight: 600 }}>{t('settings.title')}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('settings.model')}</span>
          <input
            list="fish-tts-models"
            value={model}
            onChange={event => setModel(event.target.value)}
            placeholder="s2.1-pro-free"
            aria-label={t('settings.model')}
            style={inputStyle}
          />
        </div>
        <datalist id="fish-tts-models">
          {modelOptions.map(id => <option key={id} value={id} />)}
        </datalist>
        <span style={{ ...hintStyle, marginLeft: '108px' }}>{t('settings.model.hint')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('settings.voice')}</span>
          <input
            value={voice}
            onChange={event => setVoice(event.target.value)}
            placeholder={t('settings.voice.placeholder')}
            aria-label={t('settings.voice')}
            style={inputStyle}
          />
        </div>
        <span style={{ ...hintStyle, marginLeft: '108px' }}>{t('settings.voice.hint')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('settings.apiKey')}</span>
          <input
            type="password"
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            placeholder={keyStatus === 'ok' ? t('settings.apiKey.placeholder') : ''}
            autoComplete="off"
            aria-label={t('settings.apiKey')}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', marginLeft: '108px', alignItems: 'center' }}>
          <span style={{
            fontSize: '12px',
            color: keyStatus === 'ok' ? 'var(--dsh-color-success, #30a46c)' : keyStatus === 'missing' ? 'var(--dsh-color-danger, #e5484d)' : undefined,
          }}>
            {keyStatus === 'ok' ? t('settings.status.keyOk') : keyStatus === 'missing' ? t('settings.status.keyMissing') : ''}
          </span>
          {keyStatus === 'ok' && (
            <button
              type="button"
              onClick={onClearKey}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', opacity: 0.7 }}
            >
              {t('settings.apiKey.clear')}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('settings.proxy')}</span>
          <input
            value={proxy}
            onChange={event => setProxy(event.target.value)}
            placeholder="http://127.0.0.1:7890"
            aria-label={t('settings.proxy')}
            style={inputStyle}
          />
        </div>
        <span style={{ ...hintStyle, marginLeft: '108px' }}>{t('settings.proxy.hint')}</span>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: '108px' }}>
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          style={{
            padding: '4px 14px',
            fontSize: '13px',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.55 : 1,
          }}
        >
          {t('settings.save')}
        </button>
        {savedAt !== null && saveError === null && (
          <span style={{ fontSize: '12px', color: 'var(--dsh-color-success, #30a46c)' }}>{t('settings.saved')}</span>
        )}
        {saveError !== null && (
          <span style={{ fontSize: '12px', color: 'var(--dsh-color-danger, #e5484d)' }}>{saveError}</span>
        )}
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={labelStyle}>{t('settings.autoplay')}</span>
          <span style={{ fontSize: '11px', opacity: 0.6 }}>{t('settings.autoplay.hint')}</span>
        </div>
        <input type="checkbox" checked={enabled} onChange={onToggle} aria-label={t('settings.autoplay')} />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.volume')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={vol}
            aria-label={t('settings.volume')}
            onChange={(event) => {
              const next = Number(event.target.value)
              setVol(next)
              setVolume(next)
            }}
            style={{ width: '140px' }}
          />
          <span style={{ fontSize: '12px', opacity: 0.75, minWidth: '34px' }}>{Math.round(vol * 100)}%</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('settings.speed')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.25}
              value={spd}
              disabled={!speedOk}
              aria-label={t('settings.speed')}
              onChange={(event) => {
                const next = Number(event.target.value)
                setSpd(next)
                setSpeed(next)
              }}
              style={{ width: '140px' }}
            />
            <span style={{ fontSize: '12px', opacity: 0.75, minWidth: '34px' }}>{Number(spd.toFixed(2))}×</span>
          </div>
        </div>
        {!speedOk && (
          <span style={{ ...hintStyle, marginLeft: '108px' }}>{t('settings.speed.unsupported')}</span>
        )}
      </div>

      <div style={{ ...rowStyle, justifyContent: 'flex-start' }}>
        <button
          type="button"
          disabled={testing || keyStatus !== 'ok' || voice.trim() === ''}
          onClick={onTest}
          style={{
            padding: '4px 14px',
            fontSize: '13px',
            cursor: testing || keyStatus !== 'ok' || voice.trim() === '' ? 'default' : 'pointer',
            opacity: testing || keyStatus !== 'ok' || voice.trim() === '' ? 0.55 : 1,
          }}
        >
          {testing || playing() ? t('settings.test.playing') : t('settings.test')}
        </button>
      </div>

      <div style={{ fontSize: '11px', opacity: 0.55, paddingTop: '4px' }}>{t('settings.sourceHint')}</div>
    </div>
  )
}

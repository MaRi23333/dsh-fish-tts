/**
 * The saved voice, manual voice draft, voice editor, and connection draft are independent.
 * Playback preferences are browser-local. API keys only travel in PUT bodies.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SavedVoice } from '../voices.ts'
import type { FishTtsKey } from './locales.ts'
import type { TtsConfig } from './tts.ts'
import { SpeakerIcon } from './icons.tsx'

export interface FishTtsSettingsInjected {
  t: (key: FishTtsKey) => string
  test: () => Promise<void>
  playing: () => boolean
  stopTest: () => void
  subscribePlayer: (listener: () => void) => () => void
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
    savedVoices?: SavedVoice[]
  }) => Promise<TtsConfig>
  models: () => Promise<string[]>
}

export type FishTtsSettingsProps =
  PropsRuntime<'settings.section'>
  & InjectFace<FishTtsSettingsInjected>

type ConnectionDraft = { model: string; proxy: string; apiKey: string }
type VoiceEditor = { mode: 'add' | 'edit'; id: string; name: string; note: string }
type VoiceErrors = Partial<Record<'id' | 'name' | 'note' | 'form', string>>
type Feedback = { message: string; error?: boolean } | null
type SaveAction = 'connection' | 'clearKey' | 'manualVoice' | 'switch' | 'voice' | 'remove'
type ButtonVariant = 'primary' | 'danger' | 'default'

const monoFont = 'Consolas, Menlo, Monaco, monospace'

const colors = {
  text: 'var(--dsw-alias-label-primary, inherit)',
  secondary: 'rgba(128, 128, 128, 0.85)',
  border: 'rgba(128, 128, 128, 0.35)',
  borderInput: 'rgba(128, 128, 128, 0.4)',
  divider: 'rgba(128, 128, 128, 0.2)',
  error: 'var(--dsw-alias-state-error-primary, #dc2626)',
  success: 'var(--dsw-alias-state-success-primary, #16a34a)',
  primary: 'rgba(37, 99, 235, 0.95)',
}
const cardStyle: CSSProperties = {
  minWidth: 0,
  padding: '12px',
  border: `1px solid ${colors.border}`,
  borderRadius: '8px',
  background: 'transparent',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}
const stackStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }
const actionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minWidth: 0 }
const hintStyle: CSSProperties = { margin: 0, fontSize: '14px', lineHeight: 1.5, opacity: 0.75, overflowWrap: 'anywhere' }
const errorStyle: CSSProperties = { margin: 0, fontSize: '12px', lineHeight: 1.5, color: colors.error, overflowWrap: 'anywhere' }
const headingStyle: CSSProperties = { margin: 0, fontSize: '15px', lineHeight: 1.5, fontWeight: 600 }
const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  fontFamily: 'inherit',
  fontSize: '14px',
  lineHeight: 1.5,
  padding: '5px 10px',
  border: `1px solid ${colors.borderInput}`,
  borderRadius: '6px',
  background: 'transparent',
  color: 'inherit',
}
const monoInputStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: monoFont,
}
const buttonStyle = (disabled: boolean, variant: ButtonVariant | boolean = 'default'): CSSProperties => {
  const isPrimary = variant === true || variant === 'primary'
  const isDanger = variant === 'danger'
  return {
    boxSizing: 'border-box',
    maxWidth: '100%',
    minWidth: 0,
    minHeight: '32px',
    padding: isPrimary ? '4px 14px' : '4px 12px',
    fontFamily: 'inherit',
    fontSize: '14px',
    lineHeight: 1.5,
    border: isPrimary
      ? '1px solid transparent'
      : isDanger
        ? '1px solid rgba(220, 38, 38, 0.55)'
        : `1px solid ${colors.borderInput}`,
    borderRadius: '6px',
    background: isPrimary ? colors.primary : 'transparent',
    color: isPrimary ? '#fff' : isDanger ? colors.error : 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    overflowWrap: 'anywhere',
  }
}

const feedbackOkStyle: CSSProperties = {
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.5,
  padding: '6px 10px',
  borderRadius: '6px',
  background: 'rgba(22, 163, 74, 0.12)',
  border: '1px solid rgba(22, 163, 74, 0.4)',
  color: 'inherit',
  overflowWrap: 'anywhere',
}
const feedbackErrorStyle: CSSProperties = {
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.5,
  padding: '6px 10px',
  borderRadius: '6px',
  background: 'rgba(220, 38, 38, 0.12)',
  border: '1px solid rgba(220, 38, 38, 0.45)',
  color: 'inherit',
  overflowWrap: 'anywhere',
}

function FeedbackMessage({ feedback }: { feedback: Feedback }): React.ReactElement | null {
  if (feedback === null) return null
  return <p role={feedback.error ? 'alert' : 'status'} aria-live="polite" style={feedback.error ? feedbackErrorStyle : feedbackOkStyle}>{feedback.message}</p>
}

export function FishTtsSettings(props: FishTtsSettingsProps): React.ReactElement {
  const { t, test, playing, stopTest, subscribePlayer, autoPlay, setAutoPlay, subscribeAutoPlay, volume, setVolume, speed, setSpeed, speedSupported, config, saveConfig, models } = props
  const ids = useId()
  const isTestPlaying = useSyncExternalStore(subscribePlayer, playing, () => false)
  const [savedConfig, setSavedConfig] = useState<TtsConfig | null>(null)
  const [manualVoiceDraft, setManualVoiceDraft] = useState('')
  const [manualVoiceFeedback, setManualVoiceFeedback] = useState<Feedback>(null)
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>({ model: '', proxy: '', apiKey: '' })
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [connectionFeedback, setConnectionFeedback] = useState<Feedback>(null)
  const [voiceEditor, setVoiceEditor] = useState<VoiceEditor | null>(null)
  const [voiceErrors, setVoiceErrors] = useState<VoiceErrors>({})
  const [voiceFeedback, setVoiceFeedback] = useState<Feedback>(null)
  const [managementFeedback, setManagementFeedback] = useState<Feedback>(null)
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelsError, setModelsError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingAction, setSavingAction] = useState<SaveAction | null>(null)
  const [enabled, setEnabled] = useState(autoPlay())
  const [vol, setVol] = useState(volume())
  const [spd, setSpd] = useState(speed())
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const persisted = useRef<TtsConfig | null>(null)
  const savingLock = useRef(false)
  const testingLock = useRef(false)
  const alive = useRef(true)
  const latestStopTest = useRef(stopTest)
  latestStopTest.current = stopTest
  const nameInput = useRef<HTMLInputElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const connectionDetails = useRef<HTMLDetailsElement>(null)
  const focusKey = useRef(false)
  const speedOk = speedSupported()

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      latestStopTest.current()
    }
  }, [])
  useEffect(() => subscribeAutoPlay(() => {
    if (alive.current) setEnabled(autoPlay())
  }), [subscribeAutoPlay, autoPlay])
  useEffect(() => {
    if (connectionOpen && focusKey.current) {
      focusKey.current = false
      keyInput.current?.focus()
    }
  }, [connectionOpen])

  useEffect(() => {
    let cancelled = false
    persisted.current = null
    setSavedConfig(null)
    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        const result = await config()
        if (cancelled || !alive.current) return
        if (!result.ok) {
          setLoadError(result.message ?? result.error ?? t('settings.loadFailed'))
          return
        }
        persisted.current = result
        setSavedConfig(result)
        setManualVoiceDraft(result.voice)
        setConnectionDraft({ model: result.model, proxy: result.proxy, apiKey: '' })
        setConnectionOpen(!result.keyConfigured)
      } catch (error) {
        if (!cancelled && alive.current) setLoadError(error instanceof Error ? error.message : t('settings.loadFailed'))
      } finally {
        if (!cancelled && alive.current) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [config, loadAttempt])

  useEffect(() => {
    let cancelled = false
    setModelsError(false)
    void (async () => {
      try {
        const ids = await models()
        if (cancelled || !alive.current) return
        setModelOptions(ids)
        setModelsError(ids.length === 0)
      } catch {
        if (!cancelled && alive.current) setModelsError(true)
      }
    })()
    return () => { cancelled = true }
  }, [models, loadAttempt])

  const savedVoices = savedConfig?.savedVoices ?? []
  const activeVoice = savedConfig?.voice.trim() ?? ''
  const currentVoice = savedVoices.find(entry => entry.id === activeVoice)
  const keyConfigured = savedConfig?.keyConfigured === true
  const manualVoiceDirty = savedConfig !== null && manualVoiceDraft.trim() !== activeVoice
  const connectionDirty = savedConfig !== null && (
    connectionDraft.model !== savedConfig.model
    || connectionDraft.proxy !== savedConfig.proxy
    || connectionDraft.apiKey.trim() !== ''
  )
  const fieldsDisabled = savedConfig === null || loading || savingAction !== null || testing
  const canStopTest = isTestPlaying || testing
  // Stopping never depends on an unsaved voice, connection draft, or load.
  const testDisabled = !canStopTest && (fieldsDisabled || manualVoiceDirty || activeVoice === '' || !keyConfigured)
  const duplicateVoice = voiceEditor?.mode === 'add'
    ? savedVoices.find(entry => entry.id === voiceEditor.id.trim())
    : undefined
  const canWrite = (): boolean => alive.current && persisted.current !== null && !savingLock.current && !testingLock.current

  // A synchronous lock covers every host mutation. A successful write updates
  // only the saved snapshot; callers decide whether to sync their own draft.
  const persistPatch = async (
    patch: Parameters<FishTtsSettingsInjected['saveConfig']>[0],
    action: SaveAction,
    fail: (message: string) => void,
  ): Promise<TtsConfig | null> => {
    if (!canWrite()) return null
    savingLock.current = true
    setSavingAction(action)
    try {
      const result = await saveConfig(patch)
      if (!alive.current) return null
      if (!result.ok) {
        fail(result.message ?? result.error ?? t('settings.saveFailed'))
        return null
      }
      persisted.current = result
      setSavedConfig(result)
      return result
    } catch (error) {
      if (alive.current) fail(error instanceof Error ? error.message : t('settings.saveFailed'))
      return null
    } finally {
      savingLock.current = false
      if (alive.current) setSavingAction(null)
    }
  }

  const editConnection = (field: keyof ConnectionDraft, value: string): void => {
    setConnectionDraft(draft => ({ ...draft, [field]: value }))
    setConnectionFeedback(null)
  }
  const openConnection = (shouldFocusKey: boolean): void => {
    if (shouldFocusKey && connectionOpen) keyInput.current?.focus()
    else focusKey.current = shouldFocusKey
    setConnectionOpen(true)
    connectionDetails.current?.scrollIntoView({ block: 'start' })
  }
  const onSaveConnection = async (): Promise<void> => {
    if (!canWrite()) return
    setConnectionFeedback(null)
    const patch: Parameters<FishTtsSettingsInjected['saveConfig']>[0] = {
      model: connectionDraft.model,
      proxy: connectionDraft.proxy,
    }
    if (connectionDraft.apiKey.trim() !== '') patch.apiKey = connectionDraft.apiKey.trim()
    const result = await persistPatch(patch, 'connection', message => setConnectionFeedback({ message, error: true }))
    if (result === null || !alive.current) return
    setConnectionDraft({ model: result.model, proxy: result.proxy, apiKey: '' })
    setConnectionFeedback({ message: t('settings.connection.saved') })
  }
  const onClearKey = async (): Promise<void> => {
    if (!canWrite() || persisted.current?.hasStoredKey !== true) return
    setConnectionFeedback(null)
    const result = await persistPatch({ clearKey: true }, 'clearKey', message => setConnectionFeedback({ message, error: true }))
    if (result === null || !alive.current) return
    setConnectionFeedback({ message: t(result.keyConfigured ? 'settings.connection.keyClearedEnv' : 'settings.connection.keyCleared') })
    if (!result.keyConfigured) setConnectionOpen(true)
  }
  const onApplyManualVoice = async (): Promise<void> => {
    const current = persisted.current
    const voice = manualVoiceDraft.trim()
    if (!canWrite() || current === null || voice === current.voice.trim()) return
    setManualVoiceFeedback(null)
    if (manualVoiceDraft.length > 256) {
      setManualVoiceFeedback({ message: t('settings.voices.idTooLong'), error: true })
      return
    }
    setVoiceFeedback(null)
    setTestError(null)
    const result = await persistPatch({ voice }, 'manualVoice', message => setManualVoiceFeedback({ message, error: true }))
    if (result === null || !alive.current) return
    setManualVoiceDraft(result.voice)
    setManualVoiceFeedback({ message: t(result.voice.trim() === '' ? 'settings.voice.cleared' : 'settings.voice.applied') })
  }
  const onSelectVoice = async (id: string): Promise<void> => {
    const current = persisted.current
    if (!canWrite() || id === '' || !current?.savedVoices.some(entry => entry.id === id)) return
    setManualVoiceFeedback(null)
    setVoiceFeedback(null)
    setManagementFeedback(null)
    setTestError(null)
    if (id === current.voice.trim()) {
      setManualVoiceDraft(current.voice)
      return
    }
    const result = await persistPatch({ voice: id }, 'switch', message => setVoiceFeedback({ message, error: true }))
    if (result === null || !alive.current) return
    setManualVoiceDraft(result.voice)
    const name = result.savedVoices.find(entry => entry.id === result.voice.trim())?.name ?? result.voice.trim()
    setVoiceFeedback({ message: `${t('settings.voices.switched')}${name}` })
  }

  const openVoiceEditor = (editor: VoiceEditor): void => {
    if (fieldsDisabled) return
    if (voiceEditor !== null) {
      setVoiceErrors(errors => ({ ...errors, form: t('settings.voices.finishEdit') }))
      nameInput.current?.focus()
      return
    }
    setVoiceFeedback(null)
    setManagementFeedback(null)
    setVoiceErrors({})
    setVoiceEditor(editor)
  }
  const openAddVoice = (id = ''): void => openVoiceEditor({ mode: 'add', id, name: '', note: '' })
  const openEditVoice = (entry: SavedVoice): void => openVoiceEditor({ mode: 'edit', ...entry })
  const updateVoiceEditor = (field: 'id' | 'name' | 'note', value: string): void => {
    setVoiceEditor(editor => editor === null || (field === 'id' && editor.mode === 'edit') ? editor : { ...editor, [field]: value })
    setVoiceErrors(errors => ({ ...errors, [field]: undefined, form: undefined }))
  }
  const cancelVoiceEditor = (): void => {
    setVoiceEditor(null)
    setVoiceErrors({})
  }
  const onSaveVoice = async (): Promise<void> => {
    const current = persisted.current
    if (!canWrite() || voiceEditor === null || current === null) return
    const { mode } = voiceEditor
    const id = voiceEditor.id.trim()
    const name = voiceEditor.name.trim()
    const note = voiceEditor.note.trim()
    const errors: VoiceErrors = {}
    if (id === '') errors.id = t('settings.voices.idRequired')
    else if (voiceEditor.id.length > 256) errors.id = t('settings.voices.idTooLong')
    if (name === '') errors.name = t('settings.voices.nameRequired')
    else if (voiceEditor.name.length > 80) errors.name = t('settings.voices.nameTooLong')
    if (voiceEditor.note.length > 500) errors.note = t('settings.voices.noteTooLong')
    const existing = current.savedVoices.find(entry => entry.id === id)
    if (mode === 'add' && existing !== undefined) errors.id = t('settings.voices.duplicate')
    if (mode === 'add' && current.savedVoices.length >= 100) errors.form = t('settings.voices.limit')
    if (mode === 'edit' && existing === undefined) errors.form = t('settings.voices.noLongerSaved')
    setVoiceErrors(errors)
    if (Object.keys(errors).length !== 0) return
    const entry = { id, name, note }
    const next = mode === 'add'
      ? [...current.savedVoices, entry]
      : current.savedVoices.map(item => item.id === id ? entry : item)
    const patch = mode === 'add' ? { voice: id, savedVoices: next } : { savedVoices: next }
    const result = await persistPatch(patch, 'voice', message => setVoiceErrors({ form: message }))
    if (result === null || !alive.current) return
    setVoiceEditor(null)
    setVoiceErrors({})
    setVoiceFeedback({ message: `${t(mode === 'add' ? 'settings.voices.added' : 'settings.voices.edited')}${name}` })
    if (mode === 'add') {
      setManualVoiceDraft(result.voice)
      setManualVoiceFeedback(null)
      setTestError(null)
    }
  }

  const requestRemoval = (entry: SavedVoice): void => {
    if (fieldsDisabled) return
    if (voiceEditor?.mode === 'edit' && voiceEditor.id === entry.id) {
      setVoiceErrors(errors => ({ ...errors, form: t('settings.voices.finishEdit') }))
      nameInput.current?.focus()
      return
    }
    setVoiceFeedback(null)
    setManagementFeedback(null)
    setPendingRemoval(entry.id)
  }
  const onRemoveVoice = async (): Promise<void> => {
    const current = persisted.current
    const id = pendingRemoval
    if (!canWrite() || id === null || current === null) return
    if (voiceEditor?.mode === 'edit' && voiceEditor.id === id) {
      setVoiceErrors(errors => ({ ...errors, form: t('settings.voices.finishEdit') }))
      nameInput.current?.focus()
      return
    }
    const name = current.savedVoices.find(entry => entry.id === id)?.name
    if (name === undefined) return
    const result = await persistPatch({ savedVoices: current.savedVoices.filter(entry => entry.id !== id) }, 'remove', message => setManagementFeedback({ message, error: true }))
    if (result === null || !alive.current) return
    setPendingRemoval(null)
    setManagementFeedback({ message: `${t('settings.voices.removed')}${name}` })
  }

  const onTest = async (): Promise<void> => {
    if (playing() || testingLock.current) {
      stopTest()
      return
    }
    const current = persisted.current
    if (current === null || savingLock.current || manualVoiceDraft.trim() !== current.voice.trim() || current.voice.trim() === '' || !current.keyConfigured) return
    testingLock.current = true
    setTesting(true)
    setTestError(null)
    try {
      // The player uses the saved host configuration. No draft is saved.
      await test()
    } catch (error) {
      if (alive.current) setTestError(error instanceof Error ? error.message : t('settings.test.failed'))
    } finally {
      testingLock.current = false
      if (alive.current) setTesting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '860px', minWidth: 0, fontSize: '14px', lineHeight: 1.6, color: 'inherit' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <h2 style={{ ...headingStyle, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SpeakerIcon playing={isTestPlaying} />
          <span>{t('settings.title')}</span>
        </h2>
      </header>

      {loading && <p role="status" aria-live="polite" style={hintStyle}>{t('settings.loading')}</p>}
      {loadError !== null && (
        <div style={actionsStyle}>
          <p role="alert" style={feedbackErrorStyle}>{t('settings.loadFailed')}: {loadError}</p>
          <button type="button" disabled={loading} onClick={() => setLoadAttempt(value => value + 1)} style={buttonStyle(loading)}>{t('settings.retry')}</button>
        </div>
      )}
      {savedConfig !== null && !keyConfigured && (
        <div role="status" style={{ ...actionsStyle, padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(217, 119, 6, 0.45)', background: 'rgba(217, 119, 6, 0.12)' }}>
          <p style={{ ...hintStyle, flex: '1 1 240px', color: 'inherit' }}>{t('settings.connection.firstStep')}</p>
          <button type="button" onClick={() => openConnection(true)} style={buttonStyle(false, 'primary')}>{t('settings.connection.configure')}</button>
        </div>
      )}

      <section aria-labelledby={`${ids}-voice-title`} style={{ ...cardStyle, ...stackStyle }}>
        <h3 id={`${ids}-voice-title`} style={headingStyle}>{t('settings.voices.section')}</h3>
        <div style={fieldStyle}>
          <label htmlFor={`${ids}-manual-id`}>{t('settings.voice')}</label>
          <div style={actionsStyle}>
            <input id={`${ids}-manual-id`} value={manualVoiceDraft} maxLength={256} disabled={fieldsDisabled} onChange={event => { setManualVoiceDraft(event.target.value); setManualVoiceFeedback(null); setTestError(null) }} placeholder={t('settings.voice.placeholder')} style={{ ...monoInputStyle, flex: '1 1 240px', width: 'auto' }} />
            <button type="button" disabled={fieldsDisabled || !manualVoiceDirty} onClick={() => { void onApplyManualVoice() }} style={buttonStyle(fieldsDisabled || !manualVoiceDirty, 'primary')}>{t(savingAction === 'manualVoice' ? 'settings.saving' : manualVoiceDraft.trim() === '' ? 'settings.voice.clear' : 'settings.voice.apply')}</button>
          </div>
          <FeedbackMessage feedback={manualVoiceFeedback} />
        </div>
        {currentVoice !== undefined && currentVoice.name.trim() !== '' && (
          <div style={{ ...stackStyle, gap: '6px' }}>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 500, overflowWrap: 'anywhere' }}>{t('settings.voices.current')}{currentVoice.name}</p>
            {currentVoice.note && <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{currentVoice.note}</p>}
            <button type="button" disabled={fieldsDisabled} onClick={() => openEditVoice(currentVoice)} style={{ ...buttonStyle(fieldsDisabled), alignSelf: 'flex-start' }}>{t('settings.voices.editCurrent')}</button>
          </div>
        )}
        {savedVoices.length > 0 && (
          <div style={fieldStyle}>
            <label htmlFor={`${ids}-switch`}>{t('settings.voices')}</label>
            <select id={`${ids}-switch`} value={currentVoice?.id ?? ''} disabled={fieldsDisabled} onChange={event => { void onSelectVoice(event.target.value) }} style={inputStyle}>
              <option value="" disabled>{t('settings.voices.choose')}</option>
              {savedVoices.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </div>
        )}
        <div style={actionsStyle}>
          {(activeVoice !== '' || canStopTest) && <button type="button" disabled={testDisabled} onClick={() => { void onTest() }} style={buttonStyle(testDisabled, keyConfigured || canStopTest)}>{t(canStopTest ? 'settings.test.stop' : 'settings.test')}</button>}
          <button type="button" disabled={fieldsDisabled} onClick={() => openAddVoice(currentVoice === undefined ? activeVoice : '')} style={buttonStyle(fieldsDisabled)}>
            {t(activeVoice !== '' && currentVoice === undefined ? 'settings.voices.nameCurrent' : 'settings.voices.add')}
          </button>
        </div>
        {manualVoiceDirty && <p role="status" style={{ margin: 0, overflowWrap: 'anywhere' }}>{t('settings.voice.unapplied')}</p>}
        {testing && !isTestPlaying && <p role="status" aria-live="polite" style={hintStyle}>{t('settings.test.playing')}</p>}
        {connectionDirty && activeVoice !== '' && (
          <div style={actionsStyle}>
            <p style={{ ...hintStyle, flex: '1 1 200px' }}>{t('settings.test.savedConnection')}</p>
            <button type="button" onClick={() => openConnection(false)} style={buttonStyle(false)}>{t('settings.connection.review')}</button>
          </div>
        )}
        {testError !== null && <p role="alert" style={feedbackErrorStyle}>{t('settings.test.failed')}: {testError}</p>}
        <FeedbackMessage feedback={voiceFeedback} />

        {voiceEditor !== null && (
          <form noValidate aria-labelledby={`${ids}-editor-title`} onSubmit={event => { event.preventDefault(); void onSaveVoice() }} style={{ ...stackStyle, gap: '10px', marginTop: '4px', padding: '12px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: 'transparent' }}>
            <h4 id={`${ids}-editor-title`} style={headingStyle}>{t(voiceEditor.mode === 'add' ? 'settings.voices.add' : 'settings.voices.editCurrent')}</h4>
            <div style={fieldStyle}>
              <label htmlFor={`${ids}-name`}>{t('settings.voices.name')}</label>
              <input id={`${ids}-name`} ref={nameInput} autoFocus value={voiceEditor.name} required aria-required="true" aria-invalid={!!voiceErrors.name} aria-describedby={voiceErrors.name ? `${ids}-name-error` : undefined} maxLength={80} disabled={fieldsDisabled} onChange={event => updateVoiceEditor('name', event.target.value)} placeholder={t('settings.voices.name.placeholder')} style={inputStyle} />
              {voiceErrors.name && <p id={`${ids}-name-error`} role="alert" style={errorStyle}>{voiceErrors.name}</p>}
            </div>
            <div style={fieldStyle}>
              <label htmlFor={`${ids}-id`}>{t('settings.voice.required')}</label>
              <input id={`${ids}-id`} value={voiceEditor.id} required aria-required="true" aria-invalid={!!voiceErrors.id || duplicateVoice !== undefined} aria-describedby={`${ids}-id-hint${voiceErrors.id || duplicateVoice ? ` ${ids}-id-error` : ''}`} readOnly={voiceEditor.mode === 'edit'} maxLength={256} disabled={fieldsDisabled} onChange={event => updateVoiceEditor('id', event.target.value)} placeholder={t('settings.voice.placeholder')} style={monoInputStyle} />
              <p id={`${ids}-id-hint`} style={hintStyle}>{t(voiceEditor.mode === 'edit' ? 'settings.voices.idReadOnly' : 'settings.voice.hint')}</p>
              {(voiceErrors.id || duplicateVoice) && <p id={`${ids}-id-error`} role="alert" style={errorStyle}>{voiceErrors.id ?? t('settings.voices.duplicate')}</p>}
            </div>
            <div style={fieldStyle}>
              <label htmlFor={`${ids}-note`}>{t('settings.voices.note')}</label>
              <textarea id={`${ids}-note`} value={voiceEditor.note} maxLength={500} rows={3} disabled={fieldsDisabled} aria-invalid={!!voiceErrors.note} aria-describedby={voiceErrors.note ? `${ids}-note-error` : undefined} onChange={event => updateVoiceEditor('note', event.target.value)} placeholder={t('settings.voices.note.placeholder')} style={{ ...inputStyle, resize: 'vertical' }} />
              {voiceErrors.note && <p id={`${ids}-note-error`} role="alert" style={errorStyle}>{voiceErrors.note}</p>}
            </div>
            {voiceErrors.form && <p role="alert" style={errorStyle}>{voiceErrors.form}</p>}
            <div style={actionsStyle}>
              <button type="submit" disabled={fieldsDisabled} style={buttonStyle(fieldsDisabled, 'primary')}>{t(savingAction === 'voice' ? 'settings.saving' : voiceEditor.mode === 'add' ? 'settings.voices.save' : 'settings.voices.saveEdit')}</button>
              <button type="button" disabled={savingAction === 'voice'} onClick={cancelVoiceEditor} style={buttonStyle(savingAction === 'voice')}>{t('settings.cancel')}</button>
            </div>
          </form>
        )}

        <details style={{ borderTop: `1px solid ${colors.divider}`, paddingTop: '10px', minWidth: 0 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 500 }}>{t('settings.voices.manage')}{savedVoices.length > 0 ? ` (${savedVoices.length})` : ''}</summary>
          <div style={{ ...stackStyle, marginTop: '10px' }}>
            {savedVoices.length === 0 && <p style={hintStyle}>{t('settings.voices.listEmpty')}</p>}
            {savedVoices.map(entry => (
              <div key={entry.id} style={{ ...stackStyle, gap: '8px', padding: '10px 0', borderBottom: `1px solid ${colors.divider}` }}>
                <div style={{ ...actionsStyle, justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                    <p style={{ margin: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>{entry.name}{entry.id === activeVoice && <span style={{ ...hintStyle, marginLeft: '8px' }}>{t('settings.voices.inUse')}</span>}</p>
                    {entry.note && <p title={entry.note} style={{ margin: 0, whiteSpace: 'pre-line', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{entry.note}</p>}
                  </div>
                  <div style={actionsStyle}>
                    <button type="button" disabled={fieldsDisabled || (entry.id === activeVoice && !manualVoiceDirty)} aria-label={`${t('settings.voices.use')} ${entry.name}`} onClick={() => { void onSelectVoice(entry.id) }} style={buttonStyle(fieldsDisabled || (entry.id === activeVoice && !manualVoiceDirty))}>{t('settings.voices.use')}</button>
                    <button type="button" disabled={fieldsDisabled} aria-label={`${t('settings.voices.edit')} ${entry.name}`} onClick={() => openEditVoice(entry)} style={buttonStyle(fieldsDisabled)}>{t('settings.voices.edit')}</button>
                    <button type="button" disabled={fieldsDisabled} aria-label={`${t('settings.voices.remove')} ${entry.name}`} onClick={() => requestRemoval(entry)} style={buttonStyle(fieldsDisabled)}>{t('settings.voices.remove')}</button>
                  </div>
                </div>
                {pendingRemoval === entry.id && (
                  <div style={{ ...stackStyle, gap: '6px', padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(220, 38, 38, 0.45)', background: 'rgba(220, 38, 38, 0.06)' }}>
                    <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{t('settings.voices.confirmRemove')} “{entry.name}”?</p>
                    <p style={hintStyle}>{t('settings.voices.removeHint')}</p>
                    <div style={actionsStyle}>
                      <button type="button" disabled={fieldsDisabled} onClick={() => { void onRemoveVoice() }} style={buttonStyle(fieldsDisabled, 'danger')}>{t('settings.voices.confirm')}</button>
                      <button type="button" disabled={savingAction === 'remove'} onClick={() => setPendingRemoval(null)} style={buttonStyle(savingAction === 'remove')}>{t('settings.cancel')}</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {activeVoice !== '' && currentVoice === undefined && <button type="button" disabled={fieldsDisabled} onClick={() => openAddVoice()} style={{ ...buttonStyle(fieldsDisabled), alignSelf: 'flex-start' }}>{t('settings.voices.addOther')}</button>}
            <FeedbackMessage feedback={managementFeedback} />
          </div>
        </details>
      </section>

      <section aria-label={t('settings.connection.title')} style={{ ...cardStyle, ...stackStyle }}>
        <details ref={connectionDetails} open={connectionOpen} onToggle={event => setConnectionOpen(event.currentTarget.open)}>
          <summary style={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>
            <span style={headingStyle}>{t('settings.connection.title')}</span>
            <span style={{ ...hintStyle, marginLeft: '10px' }}>{connectionDirty ? t('settings.connection.unsaved') : savedConfig !== null ? t(keyConfigured ? 'settings.status.keyOk' : 'settings.status.keyMissing') : ''}</span>
          </summary>
          <div style={{ ...stackStyle, gap: '16px', marginTop: '16px' }}>
            <div style={fieldStyle}>
              <label htmlFor={`${ids}-key`}>{t('settings.apiKey')}</label>
              <input id={`${ids}-key`} ref={keyInput} type="password" value={connectionDraft.apiKey} disabled={fieldsDisabled} onChange={event => editConnection('apiKey', event.target.value)} placeholder={keyConfigured ? t('settings.apiKey.placeholder') : t('settings.apiKey.newPlaceholder')} autoComplete="off" style={monoInputStyle} />
              {savedConfig?.hasStoredKey && <button type="button" disabled={fieldsDisabled} onClick={() => { void onClearKey() }} style={{ ...buttonStyle(fieldsDisabled, 'danger'), alignSelf: 'flex-start' }}>{t('settings.apiKey.clear')}</button>}
            </div>
            <div style={fieldStyle}>
              <label htmlFor={`${ids}-model`}>{t('settings.model')}</label>
              <input id={`${ids}-model`} list={`${ids}-models`} value={connectionDraft.model} disabled={fieldsDisabled} onChange={event => editConnection('model', event.target.value)} placeholder="s2.1-pro-free" style={monoInputStyle} />
              <datalist id={`${ids}-models`}>{modelOptions.map(id => <option key={id} value={id} />)}</datalist>
              {modelsError && <p role="status" style={errorStyle}>{t('settings.modelsFailed')}</p>}
            </div>
            <div style={fieldStyle}>
              <label htmlFor={`${ids}-proxy`}>{t('settings.proxy')}</label>
              <input id={`${ids}-proxy`} value={connectionDraft.proxy} disabled={fieldsDisabled} onChange={event => editConnection('proxy', event.target.value)} placeholder={t('settings.proxy.placeholder')} style={monoInputStyle} />
            </div>
            <div style={actionsStyle}>
              <button type="button" disabled={fieldsDisabled || !connectionDirty} onClick={() => { void onSaveConnection() }} style={buttonStyle(fieldsDisabled || !connectionDirty, 'primary')}>{t(savingAction === 'connection' ? 'settings.saving' : 'settings.connection.save')}</button>
            </div>
          </div>
        </details>
        <FeedbackMessage feedback={connectionFeedback} />
      </section>

      <section aria-labelledby={`${ids}-preferences`} style={{ ...cardStyle, ...stackStyle }}>
        <div style={{ ...stackStyle, gap: '4px' }}>
          <h3 id={`${ids}-preferences`} style={headingStyle}>{t('settings.preferences.title')}</h3>
        </div>
        <div style={{ ...actionsStyle, justifyContent: 'space-between' }}>
          <label htmlFor={`${ids}-autoplay`}>{t('settings.autoplay')}</label>
          <input id={`${ids}-autoplay`} type="checkbox" checked={enabled} onChange={() => { const next = !enabled; setEnabled(next); setAutoPlay(next) }} style={{ width: '18px', height: '18px', accentColor: colors.primary }} />
        </div>
        <div style={{ ...actionsStyle, justifyContent: 'space-between' }}>
          <label htmlFor={`${ids}-volume`}>{t('settings.volume')}</label>
          <div style={{ ...actionsStyle, flex: '0 1 240px', flexWrap: 'nowrap' }}>
            <input id={`${ids}-volume`} type="range" min={0} max={1} step={0.05} value={vol} onChange={event => { const next = Number(event.target.value); setVol(next); setVolume(next) }} style={{ minWidth: 0, width: '180px', maxWidth: '100%', accentColor: colors.primary }} />
            <output htmlFor={`${ids}-volume`} style={{ flexShrink: 0, minWidth: '38px' }}>{Math.round(vol * 100)}%</output>
          </div>
        </div>
        <div style={{ ...actionsStyle, justifyContent: 'space-between' }}>
          <label htmlFor={`${ids}-speed`}>{t('settings.speed')}</label>
          <div style={{ ...actionsStyle, flex: '0 1 240px', flexWrap: 'nowrap' }}>
            <input id={`${ids}-speed`} type="range" min={0.5} max={2} step={0.25} value={speedOk ? spd : 1} disabled={!speedOk} onChange={event => { const next = Number(event.target.value); setSpd(next); setSpeed(next) }} style={{ minWidth: 0, width: '180px', maxWidth: '100%', accentColor: colors.primary }} />
            <output htmlFor={`${ids}-speed`} style={{ flexShrink: 0, minWidth: '38px' }}>{Number((speedOk ? spd : 1).toFixed(2))}×</output>
          </div>
        </div>
        {!speedOk && <p style={errorStyle}>{t('settings.speed.unsupported')}</p>}
      </section>
    </div>
  )
}

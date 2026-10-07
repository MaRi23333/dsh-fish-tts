/** Auto-read remains usable for this session when browser storage is denied. */
const KEY = 'fish-tts.autoplay'
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function createAutoPlayPreference(storage: () => PreferenceStorage): {
  enabled: () => boolean
  set: (value: boolean) => void
  subscribe: (listener: () => void) => () => void
} {
  let enabled = false
  try { enabled = storage().getItem(KEY) === '1' } catch { /* session default */ }
  const listeners = new Set<() => void>()
  return {
    enabled: () => enabled,
    set(value) {
      enabled = value
      try {
        if (value) storage().setItem(KEY, '1')
        else storage().removeItem(KEY)
      } catch { /* keep the in-memory preference */ }
      for (const listener of listeners) {
        try { listener() } catch { /* ignore stale subscribers */ }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

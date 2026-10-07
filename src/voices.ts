/** A user's local bookmark for a Fish Audio reference_id. */
export interface SavedVoice {
  id: string
  name: string
  note: string
}

const MAX_VOICES = 100
const MAX_ID_CHARS = 256
const MAX_NAME_CHARS = 80
const MAX_NOTE_CHARS = 500
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/
const NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

/**
 * Validate the complete list before it is persisted or exposed. Only the
 * public fields are copied; callers receive a fresh list with fresh entries.
 * A missing note is supported for API clients and older local bookmarks.
 */
export function normalizeSavedVoices(value: unknown): SavedVoice[] | null {
  if (!Array.isArray(value) || value.length > MAX_VOICES) return null
  const result: SavedVoice[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
    const { id, name, note = '' } = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string' || typeof note !== 'string') return null
    if (id.length > MAX_ID_CHARS || name.length > MAX_NAME_CHARS || note.length > MAX_NOTE_CHARS) return null
    if (CONTROL_CHARACTERS.test(id) || CONTROL_CHARACTERS.test(name) || NOTE_CONTROL_CHARACTERS.test(note)) return null
    const normalizedId = id.trim()
    const normalizedName = name.trim()
    if (normalizedId === '' || normalizedName === '' || ids.has(normalizedId)) return null
    ids.add(normalizedId)
    result.push({ id: normalizedId, name: normalizedName, note: note.trim() })
  }
  return result
}

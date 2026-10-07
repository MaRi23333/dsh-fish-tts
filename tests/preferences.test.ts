import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAutoPlayPreference } from '../src/client/preferences.ts'

test('saved auto-read preference initializes both controls and persists changes', () => {
  const store = new Map([['fish-tts.autoplay', '1']])
  const preference = createAutoPlayPreference(() => ({
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) },
  }))
  assert.equal(preference.enabled(), true)
  const controls: boolean[] = []
  preference.subscribe(() => { controls.push(preference.enabled()) })
  preference.subscribe(() => { controls.push(preference.enabled()) })
  preference.set(false)
  assert.equal(store.has('fish-tts.autoplay'), false)
  preference.set(true)
  assert.equal(store.get('fish-tts.autoplay'), '1')
  assert.deepEqual(controls, [false, false, true, true])
})

test('denied browser storage still allows session-local toggles and unsubscribe', () => {
  const preference = createAutoPlayPreference(() => { throw new Error('storage denied') })
  const states: boolean[] = []
  const off = preference.subscribe(() => { states.push(preference.enabled()) })
  preference.set(true)
  assert.equal(preference.enabled(), true)
  preference.set(false)
  assert.equal(preference.enabled(), false)
  off()
  preference.set(true)
  assert.deepEqual(states, [true, false])
})

test('storage write failure and a stale subscriber do not reset the live preference', () => {
  const preference = createAutoPlayPreference(() => ({
    getItem: () => null,
    setItem: () => { throw new Error('write denied') },
    removeItem: () => { throw new Error('remove denied') },
  }))
  const states: boolean[] = []
  preference.subscribe(() => { throw new Error('stale control') })
  preference.subscribe(() => { states.push(preference.enabled()) })
  preference.set(true)
  preference.set(false)
  assert.deepEqual(states, [true, false])
})

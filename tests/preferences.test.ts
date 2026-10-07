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

test('shared storage changes are read across preference instances, including removal', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  const first = createAutoPlayPreference(() => storage)
  const second = createAutoPlayPreference(() => storage)
  assert.equal(first.enabled(), false)
  assert.equal(second.enabled(), false)
  first.set(true)
  assert.equal(second.enabled(), true)
  second.set(false)
  assert.equal(first.enabled(), false)
  second.set(true)
  assert.equal(first.enabled(), true)
  store.delete('fish-tts.autoplay')
  assert.equal(first.enabled(), false)
  assert.equal(second.enabled(), false)
})

test('failed storage reads retain the session preference and recover shared reads', () => {
  const store = new Map([['fish-tts.autoplay', '1']])
  let readDenied = false
  const preference = createAutoPlayPreference(() => ({
    getItem: key => {
      if (readDenied) throw new Error('read denied')
      return store.get(key) ?? null
    },
    setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) },
  }))
  assert.equal(preference.enabled(), true)
  readDenied = true
  store.delete('fish-tts.autoplay')
  assert.equal(preference.enabled(), true)
  preference.set(false)
  assert.equal(preference.enabled(), false)
  preference.set(true)
  assert.equal(preference.enabled(), true)
  readDenied = false
  store.delete('fish-tts.autoplay')
  assert.equal(preference.enabled(), false)
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
  assert.equal(preference.enabled(), true)
  preference.set(false)
  assert.equal(preference.enabled(), false)
  assert.deepEqual(states, [true, false])
})

test('failed writes retain session overrides until a successful local write', () => {
  const store = new Map<string, string>()
  let writeDenied = true
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (writeDenied) throw new Error('write denied')
      store.set(key, value)
    },
    removeItem: (key: string) => {
      if (writeDenied) throw new Error('remove denied')
      store.delete(key)
    },
  }
  const first = createAutoPlayPreference(() => storage)
  const second = createAutoPlayPreference(() => storage)
  first.set(true)
  assert.equal(first.enabled(), true)
  assert.equal(second.enabled(), false)
  store.set('fish-tts.autoplay', '1')
  first.set(false)
  assert.equal(store.get('fish-tts.autoplay'), '1')
  assert.equal(first.enabled(), false)
  assert.equal(second.enabled(), true)
  writeDenied = false
  first.set(true)
  second.set(false)
  assert.equal(first.enabled(), false)
})

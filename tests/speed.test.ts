/**
 * Playback-speed preference tests: clamping, persistence, and the
 * pitch-preserving support gate — browsers without `preservesPitch` must
 * stay at 1x instead of chipmunking.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSpeed, setSpeed, speedSupported, applySpeed } from '../src/client/tts.ts'

const SPEED_KEY = 'fish-tts.speed'

function globalAny(): Record<string, unknown> {
  return globalThis as Record<string, unknown>
}

/** Install a Map-backed window.localStorage stub; returns a restore fn. */
function installStorage(store: Map<string, string>): () => void {
  const previous = globalAny()['window']
  globalAny()['window'] = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key) as string : null),
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    },
  }
  return () => {
    if (previous === undefined) delete globalAny()['window']
    else globalAny()['window'] = previous
  }
}

/** Install an HTMLAudioElement stub with the given prototype capabilities. */
function installAudioElement(caps: { playbackRate?: boolean; preservesPitch?: boolean }): () => void {
  const previous = globalAny()['HTMLAudioElement']
  class FakeAudioElement {}
  const proto = FakeAudioElement.prototype as unknown as Record<string, unknown>
  if (caps.playbackRate === true) proto['playbackRate'] = 1
  if (caps.preservesPitch === true) proto['preservesPitch'] = true
  globalAny()['HTMLAudioElement'] = FakeAudioElement
  return () => {
    if (previous === undefined) delete globalAny()['HTMLAudioElement']
    else globalAny()['HTMLAudioElement'] = previous
  }
}

test('speed defaults to 1x with empty storage', () => {
  const restore = installStorage(new Map())
  try {
    assert.equal(getSpeed(), 1)
  } finally {
    restore()
  }
})

test('setSpeed persists and getSpeed reads back', () => {
  const store = new Map<string, string>()
  const restore = installStorage(store)
  try {
    setSpeed(1.25)
    assert.equal(store.get(SPEED_KEY), '1.25')
    assert.equal(getSpeed(), 1.25)
  } finally {
    restore()
  }
})

test('speed is clamped to the 0.5..2.0 range', () => {
  const restore = installStorage(new Map())
  try {
    setSpeed(3)
    assert.equal(getSpeed(), 2)
    setSpeed(0.1)
    assert.equal(getSpeed(), 0.5)
  } finally {
    restore()
  }
})

test('a corrupt stored value falls back to 1x', () => {
  const store = new Map<string, string>([[SPEED_KEY, 'not-a-number']])
  const restore = installStorage(store)
  try {
    assert.equal(getSpeed(), 1)
  } finally {
    restore()
  }
})

test('empty or out-of-range stored values fall back to 1x (never 0.5x)', () => {
  const store = new Map<string, string>()
  const restore = installStorage(store)
  try {
    for (const bad of ['', '   ', '0', '0.2', '3', '-1', 'Infinity', 'NaN']) {
      store.set(SPEED_KEY, bad)
      assert.equal(getSpeed(), 1, `stored ${JSON.stringify(bad)} must fall back to 1x`)
    }
    // in-range values still read back as stored
    for (const good of ['0.5', '1.25', '2']) {
      store.set(SPEED_KEY, good)
      assert.equal(getSpeed(), Number(good), `stored ${good} must be honoured`)
    }
  } finally {
    restore()
  }
})

test('broken storage: reads fall back to 1x, writes never throw', () => {
  const previous = globalAny()['window']
  globalAny()['window'] = {
    localStorage: {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    },
  }
  try {
    assert.equal(getSpeed(), 1)
    setSpeed(1.5) // must not throw
  } finally {
    if (previous === undefined) delete globalAny()['window']
    else globalAny()['window'] = previous
  }
})

test('speedSupported is false without HTMLAudioElement (node)', () => {
  assert.equal(speedSupported(), false)
})

test('speedSupported requires preservesPitch on the prototype', () => {
  const restore = installAudioElement({ playbackRate: true })
  try {
    assert.equal(speedSupported(), false)
  } finally {
    restore()
  }
  const restoreFull = installAudioElement({ playbackRate: true, preservesPitch: true })
  try {
    assert.equal(speedSupported(), true)
  } finally {
    restoreFull()
  }
})

test('applySpeed leaves the clip at 1x where pitch preservation is missing', () => {
  const restoreStorage = installStorage(new Map([[SPEED_KEY, '1.5']]))
  const restoreAudio = installAudioElement({ playbackRate: true })
  const clip = { preservesPitch: false, playbackRate: 1, defaultPlaybackRate: 1 } as unknown as HTMLAudioElement
  try {
    applySpeed(clip)
    assert.equal(clip.playbackRate, 1, 'rate must stay at 1x without preservesPitch')
    assert.equal(clip.defaultPlaybackRate, 1, 'default rate must stay at 1x too')
    assert.equal(clip.preservesPitch, false)
  } finally {
    restoreAudio()
    restoreStorage()
  }
})

test('applySpeed sets live and default rate plus pitch preservation', () => {
  const restoreStorage = installStorage(new Map([[SPEED_KEY, '1.5']]))
  const restoreAudio = installAudioElement({ playbackRate: true, preservesPitch: true })
  const clip = { preservesPitch: false, playbackRate: 1, defaultPlaybackRate: 1 } as unknown as HTMLAudioElement
  try {
    applySpeed(clip)
    assert.equal(clip.playbackRate, 1.5)
    assert.equal(clip.defaultPlaybackRate, 1.5, 'default rate is set so metadata load cannot reset to 1x')
    assert.equal(clip.preservesPitch, true)
  } finally {
    restoreAudio()
    restoreStorage()
  }
})

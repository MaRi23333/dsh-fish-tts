import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FishTtsPlayer, REPL_EN } from '../src/client/tts.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** All requests and audio are local stubs; no browser or network is needed. */
function browser(fetcher: typeof fetch, playError?: Error) {
  const global = globalThis as Record<string, unknown>
  const before = new Map(['fetch', 'Audio', 'HTMLAudioElement'].map(key => [key, global[key]]))
  const create = URL.createObjectURL
  const revoke = URL.revokeObjectURL
  const clips: FakeAudio[] = []
  const urls: string[] = []
  const revoked: string[] = []
  class FakeAudio extends EventTarget {
    paused = true
    ended = false
    volume = 1
    constructor(readonly src: string) { super(); clips.push(this) }
    pause() { this.paused = true }
    async play() {
      if (playError) throw playError
      this.paused = false
    }
  }
  global.fetch = fetcher
  global.Audio = FakeAudio
  global.HTMLAudioElement = FakeAudio
  URL.createObjectURL = () => {
    const url = `blob:test-${urls.length}`
    urls.push(url)
    return url
  }
  URL.revokeObjectURL = url => { revoked.push(url) }
  return {
    clips, urls, revoked,
    restore() {
      for (const [key, value] of before) {
        if (value === undefined) delete global[key]
        else global[key] = value
      }
      URL.createObjectURL = create
      URL.revokeObjectURL = revoke
    },
  }
}

const audioResponse = () => new Response(new Uint8Array(128), { headers: { 'content-type': 'audio/wav' } })

test('identical replies have separate owners and switching stops the previous clip', async () => {
  const stub = browser(async () => audioResponse())
  const player = new FishTtsPlayer()
  try {
    await player.play('same reply', REPL_EN, 'message-a')
    assert.equal(player.playingFor('message-a'), true)
    assert.equal(player.playingFor('message-b'), false)
    await player.play('same reply', REPL_EN, 'message-b')
    assert.equal(stub.clips.length, 2)
    assert.equal(stub.clips[0].paused, true)
    assert.equal(player.playingFor('message-a'), false)
    assert.equal(player.playingFor('message-b'), true)
    player.stopFor('message-a')
    assert.equal(player.playingFor('message-b'), true, 'an old message cannot stop the new one')
    player.stopFor('message-b')
    assert.equal(player.playing, false)
    assert.deepEqual(stub.revoked, stub.urls)
  } finally { player.stop(); stub.restore() }
})

test('stop aborts the pending browser request and cancellation is not a failure', async () => {
  let signal!: AbortSignal
  const stub = browser(async (_url, init) => {
    signal = init!.signal!
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    })
  })
  const player = new FishTtsPlayer()
  try {
    const playing = player.play('reply', REPL_EN, 'message-a')
    assert.equal(player.pendingFor('message-a'), true)
    player.stop()
    assert.equal(signal.aborted, true)
    await playing
    assert.equal(player.pendingFor('message-a'), false)
    assert.equal(stub.clips.length, 0)
    assert.equal(stub.urls.length, 0)
  } finally { player.stop(); stub.restore() }
})

test('late superseded responses cannot play or clear the new message state', async () => {
  const old = deferred<Response>()
  const signals: AbortSignal[] = []
  let requests = 0
  const stub = browser(async (_url, init) => {
    signals.push(init!.signal!)
    return ++requests === 1 ? await old.promise : audioResponse()
  })
  const player = new FishTtsPlayer()
  try {
    const first = player.play('first', REPL_EN, 'message-a')
    await player.play('second', REPL_EN, 'message-b')
    assert.equal(signals[0].aborted, true)
    old.resolve(audioResponse())
    await first
    assert.equal(stub.clips.length, 1)
    assert.equal(player.playingFor('message-b'), true)
  } finally { player.stop(); stub.restore() }
})

test('late superseded errors are ignored while current errors remain visible', async () => {
  const old = deferred<Response>()
  let requests = 0
  const stub = browser(async () => ++requests === 1 ? await old.promise : audioResponse())
  const player = new FishTtsPlayer()
  try {
    const first = player.play('first', REPL_EN, 'message-a')
    await player.play('second', REPL_EN, 'message-b')
    old.reject(new Error('obsolete request failed'))
    await first
    assert.equal(player.playingFor('message-b'), true)
  } finally { player.stop(); stub.restore() }
})

test('playback rejection releases its blob and clears pending and playing state', async () => {
  const stub = browser(async () => audioResponse(), new Error('playback denied'))
  const player = new FishTtsPlayer()
  try {
    await assert.rejects(player.play('reply', REPL_EN, 'message-a'), /playback denied/)
    assert.equal(player.pendingFor('message-a'), false)
    assert.equal(player.playing, false)
    assert.deepEqual(stub.revoked, stub.urls)
  } finally { player.stop(); stub.restore() }
})

test('upstream errors keep their error code and notify controls out of pending state', async () => {
  const stub = browser(async () => new Response(JSON.stringify({ error: 'voice-required' }), { status: 400 }))
  const player = new FishTtsPlayer()
  const states: boolean[] = []
  const off = player.subscribe(() => { states.push(player.pendingFor('message-a')) })
  try {
    await assert.rejects(player.play('reply', REPL_EN, 'message-a'), { code: 'voice-required' })
    assert.deepEqual(states, [true, false])
    assert.equal(stub.clips.length, 0)
  } finally { off(); player.stop(); stub.restore() }
})

test('audio ending or failing releases the URL and notifies subscribers immediately', async () => {
  const stub = browser(async () => audioResponse())
  const player = new FishTtsPlayer()
  const states: boolean[] = []
  const off = player.subscribe(() => { states.push(player.playingFor('message-a')) })
  try {
    await player.play('reply', REPL_EN, 'message-a')
    assert.equal(states.at(-1), true)
    stub.clips[0].dispatchEvent(new Event('ended'))
    assert.equal(states.at(-1), false)
    await player.play('reply', REPL_EN, 'message-a')
    stub.clips[1].dispatchEvent(new Event('error'))
    assert.equal(states.at(-1), false)
    assert.deepEqual(stub.revoked, stub.urls)
    off()
    const count = states.length
    player.stop()
    assert.equal(states.length, count)
  } finally { off(); player.stop(); stub.restore() }
})

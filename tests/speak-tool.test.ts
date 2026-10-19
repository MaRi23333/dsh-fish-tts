/**
 * fish_tts_speak tool contract exercised against createSpeakTool with fake
 * deps: delivery handshake, rate-limit slot semantics (claim before
 * synthesis, release when nothing was sent), error-code mapping, the
 * no-absolute-path rule, and the opportunistic TTL sweep.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSpeakTool, DeliveryRegistry, RateLimiter, DEFAULT_SPEAK_SETTINGS, SPEAK_TOOL_NAME } from '../src/speak.ts'
import type { SpeakDelivery, SpeakSettings, SpeakSynthesisRequest, SpeakToolDeps } from '../src/speak.ts'

function freshOutDir(): string {
  return mkdtempSync(join(tmpdir(), 'fish-tts-speak-'))
}

interface Harness {
  deps: SpeakToolDeps
  tool: Record<string, unknown> & {
    execute: (args: unknown, exec?: { signal?: AbortSignal; agent?: unknown }) => Promise<Record<string, unknown>>
  }
  outDir: string
  deliveries: DeliveryRegistry
  synths: Array<SpeakSynthesisRequest>
  failSynth: (error: unknown) => void
  settings: SpeakSettings
}

function makeHarness(overrides: Partial<SpeakToolDeps> = {}): Harness {
  const outDir = freshOutDir()
  const settings: SpeakSettings = { ...DEFAULT_SPEAK_SETTINGS }
  const synths: Array<SpeakSynthesisRequest> = []
  let synthFailure: unknown = null
  const deliveries = new DeliveryRegistry()
  const deps: SpeakToolDeps = {
    settings: () => settings,
    defaultVoice: () => 'ref-default-voice',
    savedVoices: () => [{ id: 'ref-abc', name: '温柔旁白', note: '' }],
    hasApiKey: () => true,
    model: () => 's2.1-pro-free',
    synthesize: async (request: SpeakSynthesisRequest): Promise<Buffer> => {
      if (synthFailure !== null) throw synthFailure
      synths.push(request)
      return Buffer.from(`audio:${request.text}`)
    },
    deliveries,
    limiter: new RateLimiter(),
    outDir: () => outDir,
    log: () => {},
    ...overrides,
  }
  const tool = createSpeakTool(deps) as Harness['tool']
  return {
    deps,
    tool,
    outDir,
    deliveries,
    synths,
    failSynth: (error: unknown) => { synthFailure = error },
    settings,
  }
}

function errorWithStatus(status: number): Error {
  const error = new Error(`upstream ${status}`)
  ;(error as { status?: number }).status = status
  return error
}

test('happy path with a claiming channel: delivered, no absolute path in result, slot kept', async () => {
  const h = makeHarness()
  const sent: Array<{ audioPath: string; text: string; sessionId: string }> = []
  h.deliveries.register('qqbot', {
    claims: (sessionId) => sessionId === 'session-a',
    deliver: async (input) => { sent.push({ audioPath: input.audioPath, text: input.text, sessionId: input.sessionId }) },
  } satisfies SpeakDelivery)

  const result = await h.tool.execute({ text: '[soft] 晚安，做个好梦（小声）' }, { agent: { session: { id: 'session-a' } } })

  assert.equal(result.delivered, true)
  assert.equal(result.channel, 'qqbot')
  assert.equal(result.chars, '[soft] 晚安，做个好梦（小声）'.length)
  assert.ok(result.fileName === undefined, 'delivered results must not leak the file name')
  const serialized = JSON.stringify(result)
  assert.ok(!serialized.includes(h.outDir), 'result must never contain the absolute out dir')
  assert.equal(sent.length, 1)
  assert.ok(sent[0].text.includes('[soft]'), 'the channel filters the exact synthesized text, tags intact')
  assert.ok(sent[0].audioPath.startsWith(h.outDir))
  assert.ok(!existsSync(sent[0].audioPath), 'a delivered file is freed immediately, not kept for the TTL')

  // The slot stays claimed after a successful send: an immediate retry is rate-limited.
  await assert.rejects(
    () => h.tool.execute({ text: '再来一条' }, { agent: { session: { id: 'session-a' } } }),
    /rate-limited/,
  )
  assert.equal(h.synths.length, 1, 'a rate-limited call must not synthesize')
  rmSync(h.outDir, { recursive: true, force: true })
})

test('no claiming channel: synthesized, kept on disk, delivered=false with file name only', async () => {
  const h = makeHarness()
  const result = await h.tool.execute({ text: '你好呀' }, { agent: { session: { id: 'web-session' } } })
  assert.equal(result.delivered, false)
  assert.ok(typeof result.fileName === 'string' && (result.fileName as string).startsWith('speak-'))
  assert.ok(!JSON.stringify(result).includes(h.outDir))
  assert.ok(existsSync(join(h.outDir, result.fileName as string)))
  rmSync(h.outDir, { recursive: true, force: true })
})

test('failed synthesis releases the slot, so a corrected retry is possible', async () => {
  const h = makeHarness()
  h.failSynth(errorWithStatus(0))
  await assert.rejects(() => h.tool.execute({ text: '第一条' }), /network/)
  h.failSynth(null)
  const result = await h.tool.execute({ text: '第二条' })
  assert.equal(result.delivered, false)
  assert.equal(h.synths.length, 1)
  rmSync(h.outDir, { recursive: true, force: true })
})

test('delivery rejection surfaces as voice-rejected and deletes the file', async () => {
  const h = makeHarness()
  h.deliveries.register('qqbot', {
    deliver: async () => { throw new Error('命中出站过滤') },
  })
  await assert.rejects(
    () => h.tool.execute({ text: '敏感内容' }),
    /voice-rejected.*命中出站过滤/s,
  )
  assert.equal(readdirSync(h.outDir).length, 0, 'a rejected voice must not leave the file behind')
  // Slot released: the next attempt synthesizes instead of being rate-limited.
  h.deliveries.register('qqbot', { deliver: async () => {} })
  const result = await h.tool.execute({ text: '换个说法' })
  assert.equal(result.delivered, true)
  rmSync(h.outDir, { recursive: true, force: true })
})

test('error codes: text-too-long, text-empty, disabled, perMinute=0, no key, no voice', async () => {
  const h = makeHarness()
  await assert.rejects(() => h.tool.execute({ text: 'x'.repeat(301) }), /text-too-long/)
  await assert.rejects(() => h.tool.execute({ text: '```js\ncode()\n```' }), /text-empty/)
  await assert.rejects(() => h.tool.execute({ text: '' }), /must be a non-empty string/)

  h.settings.enabled = false
  await assert.rejects(() => h.tool.execute({ text: '你好' }), /disabled/)
  h.settings.enabled = true

  h.settings.perMinute = 0
  await assert.rejects(() => h.tool.execute({ text: '你好' }), /rate-limited.*0/s)
  h.settings.perMinute = 1

  const noKey = makeHarness({ hasApiKey: () => false })
  await assert.rejects(() => noKey.tool.execute({ text: '你好' }), /\(auth\)/)

  const noVoice = makeHarness({ defaultVoice: () => '' })
  await assert.rejects(() => noVoice.tool.execute({ text: '你好' }), /voice-not-configured/)
})

test('synthesis failures map by upstream status: 401 auth, 429 quota, other failed', async () => {
  for (const [status, code] of [[401, 'auth'], [403, 'auth'], [402, 'quota'], [429, 'quota'], [500, 'failed']] as const) {
    const h = makeHarness()
    h.failSynth(errorWithStatus(status))
    await assert.rejects(() => h.tool.execute({ text: '你好' }), new RegExp(`\\(${code}\\)`))
  }
})

test('a hung delivery hits the ceiling: voice-rejected, file kept for the TTL, slot released', async () => {
  const h = makeHarness({ deliverTimeoutMs: 30 })
  h.deliveries.register('qqbot', { deliver: () => new Promise<void>(() => {}) })
  await assert.rejects(() => h.tool.execute({ text: '你好' }), /voice-rejected.*delivery timed out/s)
  assert.equal(readdirSync(h.outDir).length, 1, 'a timed-out delivery may still complete channel-side; the file stays')
  // Slot released: the next call synthesizes instead of being rate-limited.
  h.deliveries.register('qqbot', { deliver: async () => {} })
  const result = await h.tool.execute({ text: '换个说法' })
  assert.equal(result.delivered, true)
  rmSync(h.outDir, { recursive: true, force: true })
})

test('absurdly large audio is rejected before touching the disk', async () => {
  const h = makeHarness()
  h.failSynth(null)
  // Swap the fake synth AFTER construction so it returns an oversized buffer.
  ;(h.deps as { synthesize: unknown }).synthesize = async () => Buffer.alloc(11 * 1024 * 1024)
  const tool = createSpeakTool(h.deps) as Harness['tool']
  await assert.rejects(() => tool.execute({ text: '你好' }), /over the .*-byte cap/)
  assert.equal(readdirSync(h.outDir).length, 0)
  rmSync(h.outDir, { recursive: true, force: true })
})

test('synthesis timeout surfaces its own code, not network', async () => {
  const h = makeHarness()
  const timeoutError = new Error('This operation was aborted')
  timeoutError.name = 'TimeoutError'
  h.failSynth(timeoutError)
  await assert.rejects(() => h.tool.execute({ text: '你好' }), /\(timeout\)/)
})

test('upstream error text is sanitized: bearer fragments redacted, length bounded', async () => {
  const h = makeHarness()
  h.failSynth(errorWithStatus(0))
  // Overwrite the failure with a leaky message.
  ;(h.deps as { synthesize: unknown }).synthesize = async () => {
    throw new Error('proxy page: Authorization: Bearer sk-leaky-key-value-123 <html>' + 'x'.repeat(500))
  }
  await assert.rejects(
    () => h.tool.execute({ text: '你好' }),
    (error: unknown) => {
      const message = (error as Error).message
      assert.ok(!message.includes('sk-leaky-key-value-123'), 'key material must be redacted')
      assert.ok(!message.includes('Authorization:'), 'authorization header must be redacted')
      assert.ok(message.length < 400, 'detail must be bounded')
      return true
    },
  )
})

test('cancelled before delivery: nothing is sent and the slot is released', async () => {
  const h = makeHarness()
  const delivered: string[] = []
  h.deliveries.register('qqbot', { deliver: async (input) => { delivered.push(input.audioPath) } })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => h.tool.execute({ text: '晚安' }, { signal: controller.signal, agent: { session: { id: 's' } } }),
    /cancelled/,
  )
  assert.equal(delivered.length, 0)
  // Slot released → the next call is not rate-limited.
  const result = await h.tool.execute({ text: '晚安' }, { agent: { session: { id: 's' } } })
  assert.equal(result.delivered, true)
  rmSync(h.outDir, { recursive: true, force: true })
})

test('prosody rides on the synthesis request; explicit voice and format are honored', async () => {
  const h = makeHarness()
  await h.tool.execute({ text: '你好', voice: '温柔旁白', format: 'wav' })
  const request = h.synths[0]
  assert.equal(request.voice, 'ref-abc')
  assert.equal(request.format, 'wav')
  assert.equal(request.volumeDb, 0)
  assert.equal(request.loudness, true)
  rmSync(h.outDir, { recursive: true, force: true })
})

test('the render line is short data, never the spoken content', async () => {
  const h = makeHarness()
  const result = await h.tool.execute({ text: '这是一句很长很长的台词内容' })
  const render = (h.tool.output as { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> }).render
  const blocks = render(null, result)
  assert.equal(blocks.length, 1)
  assert.ok(!blocks[0].text.includes('很长很长的台词'), 'render must not echo the spoken content')
  assert.ok(!/已发送/.test(blocks[0].text), 'render must not narrate "voice sent"')
  rmSync(h.outDir, { recursive: true, force: true })
})

test('stale speak files are swept by the TTL cleanup after a call', async () => {
  const h = makeHarness()
  const stale = join(h.outDir, 'speak-stale.mp3')
  writeFileSync(stale, 'old')
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000)
  utimesSync(stale, yesterday, yesterday)
  await h.tool.execute({ text: '你好' })
  assert.ok(!existsSync(stale), 'files older than 24h must be removed')
  rmSync(h.outDir, { recursive: true, force: true })
})

test('a claims hook that throws counts as not claimed; the next channel still gets it', async () => {
  const h = makeHarness()
  const delivered: string[] = []
  h.deliveries.register('first', {
    claims: () => { throw new Error('claims exploded') },
    deliver: async (input) => { delivered.push(`first:${input.audioPath}`) },
  })
  h.deliveries.register('qqbot', {
    claims: () => true,
    deliver: async (input) => { delivered.push(`qqbot:${input.audioPath}`) },
  })
  const result = await h.tool.execute({ text: '你好' }, { agent: { session: { id: 's' } } })
  assert.equal(result.delivered, true)
  assert.equal(result.channel, 'qqbot')
  assert.equal(delivered.length, 1)
  assert.ok(delivered[0].startsWith('qqbot:'))
  rmSync(h.outDir, { recursive: true, force: true })
})

test('tool name and registration-facing shape', () => {
  const h = makeHarness()
  assert.equal(h.tool.name, SPEAK_TOOL_NAME)
  assert.equal(h.tool.timeoutMs, 20000)
  const output = h.tool.output as { schema: { required: string[] }; render: unknown }
  assert.deepEqual(output.schema.required.sort(), ['bytes', 'chars', 'delivered', 'format', 'mime'])
  assert.equal(typeof output.render, 'function')
})

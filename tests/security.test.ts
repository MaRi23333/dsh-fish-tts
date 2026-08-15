/**
 * Route security tests (FISH-SEC-001 / FISH-SEC-002 / FISH-SEC-003 /
 * FISH-TEST-001 / FISH-TEST-002): content-type guard, cross-origin and
 * non-loopback rejection, business-layer 400/413 responses, proxy-credential
 * refusal/redaction/sanitization, key-source isolation.
 *
 * Network policy (FISH-TEST-002): `isolateEnvironment()` strips real
 * credentials from the test process BEFORE any plugin logic runs, and
 * `installFailClosedNetwork()` makes every un-mocked upstream call fail
 * immediately. Only explicit local MockAgent intercepts may answer; the
 * real Fish API is never contacted. All credentials used here are fictional.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { makeCtx, makeWeb, dispatch, jsonBody } from './helpers.ts'
import { isolateEnvironment, installFailClosedNetwork } from './env-isolation.ts'

// Isolation must run before any plugin code is imported/executed.
isolateEnvironment()
const failClosed = installFailClosedNetwork()

// Fictional values only — never a real Fish Audio key or voice id.
const FAKE_KEY = 'FISH-TTS-TEST-KEY-0123456789abcdef'
const FAKE_VOICE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'fish-tts-sec-'))
}

function mount(options: { stateDir?: string; proxy?: string } = {}) {
  const web = makeWeb()
  const ctx = makeCtx(web)
  apply(ctx as unknown as Context, { stateDir: options.stateDir, proxy: options.proxy })
  return web
}

test('non-JSON POST to synthesize is rejected with 415', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const res = await dispatch(web, '/fish-tts/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
  })
  assert.equal(res.status, 415)
  assert.equal(jsonBody(res).error, 'content-type-json-required')
})

test('cross-origin Origin on PUT config is rejected with 403', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const res = await dispatch(web, '/fish-tts/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: '{"voice":""}',
  })
  assert.equal(res.status, 403)
  assert.equal(jsonBody(res).error, 'cross-origin-forbidden')
})

test('non-loopback peers are rejected on every route with 403', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const cases: Array<{ path: string; opts: Record<string, unknown> }> = [
    { path: '/fish-tts/synthesize', opts: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"hi"}' } },
    { path: '/fish-tts/config', opts: { method: 'GET' } },
    { path: '/fish-tts/config', opts: { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"voice":""}' } },
    { path: '/fish-tts/status', opts: {} },
    { path: '/fish-tts/models', opts: {} },
  ]
  for (const { path, opts } of cases) {
    const res = await dispatch(web, path, { ...opts, remoteAddress: '192.168.1.10' } as never)
    assert.equal(res.status, 403, `route ${path} must reject non-loopback peers`)
    assert.equal(jsonBody(res).error, 'non-loopback-forbidden', `route ${path}`)
  }
})

test('IPv6 loopback peers pass the guard and reach the business layer', async () => {
  const web = mount({ stateDir: freshStateDir() })
  // Empty voice → 400 voice-required proves the request got past the guards.
  const res = await dispatch(web, '/fish-tts/synthesize', {
    method: 'POST',
    remoteAddress: '::1',
    headers: { 'content-type': 'application/json' },
    body: '{"text":"hello"}',
  })
  assert.equal(res.status, 400)
  assert.equal(jsonBody(res).error, 'voice-required')
})

test('IPv4-mapped loopback peers pass the guard', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const res = await dispatch(web, '/fish-tts/config', {
    method: 'PUT',
    remoteAddress: '::ffff:127.0.0.1',
    headers: { 'content-type': 'application/json' },
    body: '{"voice":"' + FAKE_VOICE + '"}',
  })
  assert.equal(res.status, 200)
  assert.equal(jsonBody(res).ok, true)
})

test('empty voice is rejected with 400 voice-required', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const res = await dispatch(web, '/fish-tts/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"text":"hello"}',
  })
  assert.equal(res.status, 400)
  assert.equal(jsonBody(res).error, 'voice-required')
})

test('text longer than 12000 chars is rejected with 413', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const res = await dispatch(web, '/fish-tts/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(12001) }),
  })
  assert.equal(res.status, 413)
  assert.equal(jsonBody(res).error, 'text-too-large')
})

test('proxy URLs with userinfo are refused at save time and never echoed', async () => {
  const dir = freshStateDir()
  const web = mount({ stateDir: dir })
  const res = await dispatch(web, '/fish-tts/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 's2.1-pro', proxy: 'http://user:secretpw@127.0.0.1:7890' }),
  })
  assert.equal(res.status, 400)
  assert.equal(jsonBody(res).error, 'invalid-proxy')
  // Nothing was persisted — including the model sent in the same patch
  // (validation happens before any field is applied).
  const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  assert.ok(saved.proxy === undefined || saved.proxy === '', 'credentialed proxy must not be persisted')
  assert.ok(saved.model === undefined || saved.model === '', 'rejected patch must not partially apply')
  const status = await dispatch(web, '/fish-tts/status')
  const payload = jsonBody(status)
  assert.equal(payload.model, 's2.1-pro-free', 'default model must be unchanged after rejected patch')
  assert.ok(!JSON.stringify(payload).includes('secretpw'), 'status must not echo proxy credentials')
})

test('non-http proxy schemes are refused at save time', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const res = await dispatch(web, '/fish-tts/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proxy: 'socks5://127.0.0.1:1080' }),
  })
  assert.equal(res.status, 400)
  assert.equal(jsonBody(res).error, 'invalid-proxy')
})

test('credential-bearing seed proxy is dropped: never on disk, never in responses (FISH-SEC-003)', async () => {
  const dir = freshStateDir()
  const web = mount({
    stateDir: dir,
    proxy: 'http://patchuser:patchpw@proxy.internal:8080',
  })
  // The seed must not be persisted verbatim (or at all).
  const raw = readFileSync(join(dir, 'settings.json'), 'utf8')
  assert.ok(!raw.includes('patchuser'), 'seed userinfo must not be written to settings.json')
  assert.ok(!raw.includes('patchpw'), 'seed password must not be written to settings.json')
  assert.ok(!raw.includes('proxy.internal'), 'credential-bearing seed must not be persisted at all')
  // Responses stay clean as well.
  const status = await dispatch(web, '/fish-tts/status')
  assert.ok(!JSON.stringify(jsonBody(status)).includes('patchpw'), 'status must not reveal seed userinfo')
  const config = await dispatch(web, '/fish-tts/config')
  assert.ok(!JSON.stringify(jsonBody(config)).includes('patchpw'), 'config must not reveal seed userinfo')
})

test('non-http seed proxy scheme is dropped without persisting', async () => {
  const dir = freshStateDir()
  const web = mount({ stateDir: dir, proxy: 'socks5://127.0.0.1:1080' })
  const raw = readFileSync(join(dir, 'settings.json'), 'utf8')
  assert.ok(!raw.includes('socks5'), 'illegal seed scheme must not be persisted')
  const config = await dispatch(web, '/fish-tts/config')
  assert.equal(jsonBody(config).proxy, '', 'config must show no proxy for dropped seed')
})

test('synthesis without an API key is rejected with 500 no-api-key (no network)', async () => {
  const web = mount({ stateDir: freshStateDir() })
  const setVoice = await dispatch(web, '/fish-tts/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voice: FAKE_VOICE }),
  })
  assert.equal(setVoice.status, 200)
  const res = await dispatch(web, '/fish-tts/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"text":"hello"}',
  })
  assert.equal(res.status, 500)
  assert.equal(jsonBody(res).error, 'no-api-key')
})

test('parent FISH_API_KEY is isolated: no-api-key stays 500 (FISH-TEST-002 regression)', async () => {
  // A parent process may export FISH_API_KEY (the platform env does). The
  // isolation layer at module load must have stripped it before any plugin
  // logic runs; if it had not, this request would carry a key and the
  // "no-api-key" claim would silently break (or worse, touch the network —
  // which the fail-closed dispatcher makes impossible).
  assert.equal(process.env.FISH_API_KEY, undefined, 'isolation must strip FISH_API_KEY from the test process')
  const web = mount({ stateDir: freshStateDir() })
  await dispatch(web, '/fish-tts/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voice: FAKE_VOICE }),
  })
  const res = await dispatch(web, '/fish-tts/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"text":"hello"}',
  })
  assert.equal(res.status, 500)
  assert.equal(jsonBody(res).error, 'no-api-key')
})

test('environment-provided key works when explicitly simulated (mocked upstream)', async () => {
  // The env-key path (resolveEnvKey) is exercised as its own explicit test
  // with a fictional key; it must go through the local mock, never the net.
  const dir = freshStateDir()
  const fakeWav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(256, 0x61)])
  const pool = failClosed.get('https://api.fish.audio')
  pool.intercept({ path: '/v1/tts', method: 'POST' })
    .reply(200, fakeWav, { headers: { 'content-type': 'audio/wav' } })

  process.env.FISH_API_KEY = FAKE_KEY
  try {
    const web = mount({ stateDir: dir })
    await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: FAKE_VOICE }),
    })
    const res = await dispatch(web, '/fish-tts/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"text":"hello env key"}',
    })
    assert.equal(res.status, 200)
    assert.ok(res.body.startsWith('RIFF'), 'audio bytes must be returned')
  } finally {
    delete process.env.FISH_API_KEY
  }
})

test('successful synthesis round-trip against a local mock, cached on repeat', async () => {
  const dir = freshStateDir()
  // Real Fish audio is far larger than the host's 64-byte minimum; pad the
  // fake WAV so it passes the empty-response guard.
  const fakeWav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(256, 0x61)])
  const pool = failClosed.get('https://api.fish.audio')
  let calls = 0
  pool.intercept({ path: '/v1/tts', method: 'POST' })
    .reply(200, () => {
      calls += 1
      return fakeWav
    }, { headers: { 'content-type': 'audio/wav' } })

  try {
    const web = mount({ stateDir: dir })
    const save = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: FAKE_VOICE, apiKey: FAKE_KEY }),
    })
    assert.equal(save.status, 200)

    const first = await dispatch(web, '/fish-tts/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"text":"hello world"}',
    })
    assert.equal(first.status, 200)
    assert.match(first.headers['content-type'] as string, /audio\/wav/)
    assert.ok(first.body.startsWith('RIFF'), 'audio bytes must be returned')

    const second = await dispatch(web, '/fish-tts/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"text":"hello world"}',
    })
    assert.equal(second.status, 200)
    assert.equal(calls, 1, 'identical text must be served from cache')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

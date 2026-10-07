/**
 * Local voice bookmarks: persistence, legacy settings compatibility and
 * atomic validation/save failures. Every credential and voice is fictional;
 * ambient credentials are removed and unmocked network calls fail closed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { SavedVoice } from '../src/voices.ts'
import { dispatch, jsonBody, makeCtx, makeWeb } from './helpers.ts'
import type { MockWeb } from './helpers.ts'
import { installFailClosedNetwork, isolateEnvironment } from './env-isolation.ts'

isolateEnvironment()
const failClosed = installFailClosedNetwork()

const FAKE_KEY = 'FISH-TTS-BOOKMARK-TEST-KEY-0123456789abcdef'
const VOICE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const VOICE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const BOOKMARK_A: SavedVoice = { id: VOICE_A, name: 'Narrator', note: 'Quiet reading' }
const BOOKMARK_B: SavedVoice = { id: VOICE_B, name: 'Character', note: '' }

function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'fish-tts-voices-'))
}

function mount(stateDir: string, seed: Config = {}): MockWeb {
  const web = makeWeb()
  apply(makeCtx(web) as unknown as Context, { ...seed, stateDir })
  return web
}

function rawStore(dir: string): string {
  return readFileSync(join(dir, 'settings.json'), 'utf8')
}

function readStore(dir: string): Record<string, unknown> {
  return JSON.parse(rawStore(dir)) as Record<string, unknown>
}

async function put(web: MockWeb, patch: Record<string, unknown>) {
  return dispatch(web, '/fish-tts/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

async function getConfig(web: MockWeb): Promise<Record<string, unknown>> {
  const res = await dispatch(web, '/fish-tts/config')
  assert.equal(res.status, 200)
  return jsonBody(res)
}

test('bookmarks round-trip through config/status and restart with only public fields', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    const saved = await put(web, {
      savedVoices: [
        { id: ` ${VOICE_A} `, name: ' Narrator ', note: ' Quiet reading ', privateMetadata: 'DO-NOT-EXPOSE' },
        { id: VOICE_B, name: 'Character' },
      ],
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(jsonBody(saved).savedVoices, [BOOKMARK_A, BOOKMARK_B])
    assert.deepEqual(readStore(dir).savedVoices, [BOOKMARK_A, BOOKMARK_B])
    assert.equal(readStore(dir).version, 1, 'bookmarks do not bump the settings schema')
    assert.ok(!rawStore(dir).includes('DO-NOT-EXPOSE'))
    for (const instance of [web, mount(dir)]) {
      for (const path of ['/fish-tts/config', '/fish-tts/status']) {
        const res = await dispatch(instance, path)
        assert.equal(res.status, 200)
        assert.deepEqual(jsonBody(res).savedVoices, [BOOKMARK_A, BOOKMARK_B])
        assert.ok(!res.body.includes('privateMetadata'))
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('multiline notes survive saving and restarting without being flattened', async () => {
  const dir = freshStateDir()
  try {
    const note = 'Soft narration\nBest for long replies\tKeep at 1x'
    const res = await put(mount(dir), { savedVoices: [{ ...BOOKMARK_A, note }] })
    assert.equal(res.status, 200)
    assert.deepEqual((await getConfig(mount(dir))).savedVoices, [{ ...BOOKMARK_A, note }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy v1 file defaults to no bookmarks without changing active settings or ciphertext', async () => {
  const dir = freshStateDir()
  try {
    const initial = mount(dir)
    const saved = await put(initial, {
      voice: VOICE_A, model: 's2.1-pro', format: 'mp3', proxy: 'http://127.0.0.1:7890', apiKey: FAKE_KEY,
    })
    assert.equal(saved.status, 200)
    const beforeRaw = rawStore(dir)
    const before = readStore(dir)
    assert.equal(before.savedVoices, undefined)
    const web = mount(dir, { voice: VOICE_B, model: 'seed-model', format: 'opus' })
    const config = await getConfig(web)
    assert.deepEqual(config.savedVoices, [])
    for (const field of ['voice', 'model', 'format', 'proxy']) assert.equal(config[field], before[field])
    assert.equal(config.keyConfigured, true)
    assert.equal(config.hasStoredKey, true)
    assert.equal(rawStore(dir), beforeRaw, 'adding an optional schema field must not rewrite a legacy file')
    const added = await put(web, { savedVoices: [BOOKMARK_B] })
    assert.equal(added.status, 200)
    assert.deepEqual(readStore(dir).apiKeyCipher, before.apiKeyCipher)
    for (const path of ['/fish-tts/config', '/fish-tts/status']) {
      const res = await dispatch(web, path)
      assert.ok(!res.body.includes(FAKE_KEY))
      assert.equal(jsonBody(res).apiKeyCipher, undefined)
      assert.equal(jsonBody(res).apiKey, undefined)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy v0 migration still preserves active voice and existing encrypted key', async () => {
  const dir = freshStateDir()
  try {
    const initial = mount(dir)
    assert.equal((await put(initial, { voice: VOICE_A, model: 's2.1-pro', apiKey: FAKE_KEY })).status, 200)
    const legacy = readStore(dir)
    delete legacy.version
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(legacy))
    const web = mount(dir, { voice: VOICE_B })
    const config = await getConfig(web)
    assert.equal(config.voice, VOICE_A)
    assert.equal(config.model, 's2.1-pro')
    assert.equal(config.keyConfigured, true)
    assert.deepEqual(config.savedVoices, [])
    assert.deepEqual(readStore(dir).apiKeyCipher, legacy.apiKeyCipher)
    assert.equal(readStore(dir).version, 1)
    assert.equal(readdirSync(dir).filter(name => name.startsWith('settings.json.corrupt-')).length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replacing a bookmark with the same id updates its name and note', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    assert.equal((await put(web, { voice: VOICE_A, savedVoices: [BOOKMARK_A] })).status, 200)
    const renamed = { ...BOOKMARK_A, name: 'Updated narrator', note: 'New remark' }
    const res = await put(web, { savedVoices: [renamed] })
    assert.equal(res.status, 200)
    assert.deepEqual(jsonBody(res).savedVoices, [renamed])
    assert.equal(jsonBody(res).voice, VOICE_A)
    assert.deepEqual((await getConfig(mount(dir))).savedVoices, [renamed])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('removing the active voice bookmark retains the independent active voice', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    assert.equal((await put(web, { voice: VOICE_A, savedVoices: [BOOKMARK_A, BOOKMARK_B] })).status, 200)
    const deleted = await put(web, { savedVoices: [BOOKMARK_B] })
    assert.equal(deleted.status, 200)
    assert.equal(jsonBody(deleted).voice, VOICE_A)
    assert.deepEqual(jsonBody(deleted).savedVoices, [BOOKMARK_B])
    assert.equal((await getConfig(mount(dir))).voice, VOICE_A)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('manual voice changes and clearing survive restart without changing bookmarks or keys', async () => {
  const dir = freshStateDir()
  try {
    // A legacy file with no voice still follows the bundle's configured voice.
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ version: 1 }))
    const web = mount(dir, { voice: VOICE_A, model: 's2.1-pro' })
    assert.equal((await getConfig(web)).voice, VOICE_A)
    assert.equal((await put(web, { savedVoices: [BOOKMARK_A, BOOKMARK_B], apiKey: FAKE_KEY })).status, 200)
    const cipher = readStore(dir).apiKeyCipher

    const manualId = 'manual-voice-without-a-bookmark'
    const applied = await put(web, { voice: ` ${manualId} ` })
    assert.equal(applied.status, 200)
    assert.equal(jsonBody(applied).voice, manualId)
    assert.deepEqual(jsonBody(applied).savedVoices, [BOOKMARK_A, BOOKMARK_B])
    assert.deepEqual(readStore(dir).apiKeyCipher, cipher)
    assert.equal((await getConfig(mount(dir, { voice: VOICE_A }))).voice, manualId)

    const cleared = await put(web, { voice: '   ' })
    assert.equal(cleared.status, 200)
    assert.equal(jsonBody(cleared).voice, '')
    assert.equal(readStore(dir).voice, '', 'persist the explicit clear instead of reviving the configured voice')
    assert.equal((await put(web, { model: 's2-pro' })).status, 200)
    const restarted = mount(dir, { voice: VOICE_B })
    for (const path of ['/fish-tts/config', '/fish-tts/status']) {
      const res = await dispatch(restarted, path)
      assert.equal(jsonBody(res).voice, '')
      assert.deepEqual(jsonBody(res).savedVoices, [BOOKMARK_A, BOOKMARK_B])
      assert.equal(jsonBody(res).hasStoredKey, true)
    }
    assert.deepEqual(readStore(dir).apiKeyCipher, cipher)
    const speech = await dispatch(restarted, '/fish-tts/synthesize', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'No voice should be used after clearing.' }),
    })
    assert.equal(speech.status, 400)
    assert.equal(jsonBody(speech).error, 'voice-required')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('omitting savedVoices preserves the list, and an empty array explicitly clears it', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    assert.equal((await put(web, { voice: VOICE_A, savedVoices: [BOOKMARK_A], apiKey: FAKE_KEY })).status, 200)
    const cipher = readStore(dir).apiKeyCipher
    const unrelated = await put(web, { model: 's2.1-pro' })
    assert.equal(unrelated.status, 200)
    assert.deepEqual(jsonBody(unrelated).savedVoices, [BOOKMARK_A])
    const cleared = await put(web, { savedVoices: [] })
    assert.equal(cleared.status, 200)
    assert.deepEqual(jsonBody(cleared).savedVoices, [])
    assert.deepEqual(readStore(dir).savedVoices, [])
    assert.equal(jsonBody(cleared).voice, VOICE_A)
    assert.deepEqual(readStore(dir).apiKeyCipher, cipher)
    assert.deepEqual((await getConfig(mount(dir))).savedVoices, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bookmark count and field limits accept their exact boundaries', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    const bookmarks = Array.from({ length: 100 }, (_, i) => ({
      id: `${i.toString().padStart(3, '0')}${'x'.repeat(253)}`,
      name: 'n'.repeat(80),
      note: 'r'.repeat(500),
    }))
    const res = await put(web, { savedVoices: bookmarks })
    assert.equal(res.status, 200)
    assert.deepEqual(jsonBody(res).savedVoices, bookmarks)
    assert.deepEqual(readStore(dir).savedVoices, bookmarks)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid bookmark lists reject all accompanying fields without echoing user values', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    assert.equal((await put(web, {
      voice: VOICE_A, model: 's2.1-pro', format: 'mp3', proxy: 'http://127.0.0.1:7890',
      savedVoices: [BOOKMARK_A], apiKey: FAKE_KEY,
    })).status, 200)
    const beforeRaw = rawStore(dir)
    const beforeConfig = await getConfig(web)
    const invalid: Array<{ label: string; value: unknown }> = [
      { label: 'null', value: null },
      { label: 'object', value: {} },
      { label: 'string', value: 'INVALID-USER-VALUE' },
      { label: 'number', value: 5 },
      { label: 'boolean', value: false },
      { label: 'null entry', value: [null] },
      { label: 'array entry', value: [[VOICE_A, 'Name']] },
      { label: 'string entry', value: ['INVALID-USER-VALUE'] },
      { label: 'missing id', value: [{ name: 'INVALID-USER-VALUE' }] },
      { label: 'missing name', value: [{ id: 'INVALID-USER-VALUE' }] },
      { label: 'empty id', value: [{ ...BOOKMARK_A, id: '' }] },
      { label: 'blank id', value: [{ ...BOOKMARK_A, id: '   ' }] },
      { label: 'empty name', value: [{ ...BOOKMARK_A, name: '' }] },
      { label: 'blank name', value: [{ ...BOOKMARK_A, name: '   ' }] },
      { label: 'numeric id', value: [{ ...BOOKMARK_A, id: 12 }] },
      { label: 'numeric name', value: [{ ...BOOKMARK_A, name: 12 }] },
      { label: 'null note', value: [{ ...BOOKMARK_A, note: null }] },
      { label: 'numeric note', value: [{ ...BOOKMARK_A, note: 12 }] },
      { label: 'duplicate id', value: [BOOKMARK_A, { ...BOOKMARK_A, name: 'Another' }] },
      { label: 'duplicate id after trimming', value: [BOOKMARK_A, { ...BOOKMARK_A, id: ` ${VOICE_A} ` }] },
      { label: 'control in id', value: [{ ...BOOKMARK_A, id: 'INVALID-USER-VALUE\u0000' }] },
      { label: 'control in name', value: [{ ...BOOKMARK_A, name: 'INVALID-USER-VALUE\n' }] },
      { label: 'control in note', value: [{ ...BOOKMARK_A, note: 'INVALID-USER-VALUE\u0085' }] },
      { label: 'long id', value: [{ ...BOOKMARK_A, id: 'i'.repeat(257) }] },
      { label: 'long name', value: [{ ...BOOKMARK_A, name: 'n'.repeat(81) }] },
      { label: 'long note', value: [{ ...BOOKMARK_A, note: 'r'.repeat(501) }] },
      { label: 'long list', value: Array.from({ length: 101 }, (_, i) => ({ id: `voice-${i}`, name: 'Voice' })) },
      { label: 'invalid last entry', value: [BOOKMARK_B, { id: 'INVALID-USER-VALUE', name: '' }] },
    ]
    for (const { label, value } of invalid) {
      for (const keyPatch of [{ apiKey: 'REPLACEMENT-TEST-KEY' }, { clearKey: true }]) {
        const res = await put(web, {
          model: 'replacement-model', voice: VOICE_B, format: 'opus', proxy: 'http://127.0.0.1:9000',
          ...keyPatch, savedVoices: value,
        })
        assert.equal(res.status, 400, label)
        assert.equal(jsonBody(res).error, 'invalid-saved-voices', label)
        assert.ok(!res.body.includes('INVALID-USER-VALUE'), label)
        assert.equal(rawStore(dir), beforeRaw, `${label}: disk remains unchanged`)
        assert.deepEqual(await getConfig(web), beforeConfig, `${label}: effective settings remain unchanged`)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid proxy rejects valid bookmarks and active voice together', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    assert.equal((await put(web, { voice: VOICE_A, savedVoices: [BOOKMARK_A], apiKey: FAKE_KEY })).status, 200)
    const beforeRaw = rawStore(dir)
    const beforeConfig = await getConfig(web)
    const res = await put(web, {
      voice: VOICE_B, savedVoices: [BOOKMARK_B], proxy: 'http://user:FAKE-PROXY-SECRET@127.0.0.1:7890', clearKey: true,
    })
    assert.equal(res.status, 400)
    assert.equal(jsonBody(res).error, 'invalid-proxy')
    assert.ok(!res.body.includes('FAKE-PROXY-SECRET'))
    assert.equal(rawStore(dir), beforeRaw)
    assert.deepEqual(await getConfig(web), beforeConfig)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('disk write failure leaves the previous active voice, bookmarks and encrypted key effective', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    assert.equal((await put(web, { voice: VOICE_A, savedVoices: [BOOKMARK_A], apiKey: FAKE_KEY })).status, 200)
    const beforeRaw = rawStore(dir)
    const beforeConfig = await getConfig(web)
    // A directory at the temporary-file path makes writeFileSync fail on all
    // supported platforms without relying on Windows ACL or chmod semantics.
    const blockedTemp = join(dir, `settings.json.tmp-${process.pid}`)
    mkdirSync(blockedTemp)
    for (const keyPatch of [{ apiKey: 'REPLACEMENT-TEST-KEY' }, { clearKey: true }]) {
      const res = await put(web, {
        voice: VOICE_B, savedVoices: [BOOKMARK_B], model: 'replacement-model', format: 'opus',
        proxy: 'http://127.0.0.1:9000', ...keyPatch,
      })
      assert.equal(res.status, 500)
      assert.equal(jsonBody(res).error, 'save-failed')
      assert.equal(rawStore(dir), beforeRaw)
      assert.deepEqual(await getConfig(web), beforeConfig)
    }
    rmSync(blockedTemp, { recursive: true })
    assert.equal((await put(web, { voice: VOICE_B, savedVoices: [BOOKMARK_B] })).status, 200)
    assert.equal((await getConfig(mount(dir))).voice, VOICE_B, 'a later successful save still works')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid saved lists on disk are hidden without disturbing other legacy settings', async () => {
  const dir = freshStateDir()
  try {
    const initial = mount(dir)
    assert.equal((await put(initial, { voice: VOICE_A, apiKey: FAKE_KEY })).status, 200)
    const legacy = { ...readStore(dir), savedVoices: [{ id: 'INVALID-USER-VALUE', name: '' }] }
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(legacy))
    const beforeRaw = rawStore(dir)
    const web = mount(dir)
    for (const path of ['/fish-tts/config', '/fish-tts/status']) {
      const res = await dispatch(web, path)
      assert.deepEqual(jsonBody(res).savedVoices, [])
      assert.equal(jsonBody(res).voice, VOICE_A)
      assert.equal(jsonBody(res).keyConfigured, true)
      assert.ok(!res.body.includes('INVALID-USER-VALUE'))
      assert.ok(!res.body.includes(FAKE_KEY))
    }
    assert.equal(rawStore(dir), beforeRaw, 'a bad optional list must not reset or migrate the settings file')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bookmark deletion leaves synthesis using the active id through an isolated local mock', async () => {
  assert.equal(process.env.FISH_API_KEY, undefined)
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) assert.equal(process.env[key], undefined)
  const dir = freshStateDir()
  const fakeWav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(256, 0x61)])
  let calls = 0
  failClosed.get('https://api.fish.audio').intercept({ path: '/v1/tts', method: 'POST' })
    .reply(200, options => {
      const payload = JSON.parse(String(options.body)) as Record<string, unknown>
      assert.equal(payload.reference_id, VOICE_A)
      calls += 1
      return fakeWav
    }, { headers: { 'content-type': 'audio/wav' } })
  try {
    const web = mount(dir)
    assert.equal((await put(web, { voice: VOICE_A, savedVoices: [BOOKMARK_A], apiKey: FAKE_KEY })).status, 200)
    assert.equal((await put(web, { savedVoices: [] })).status, 200)
    assert.equal(calls, 0, 'saving and clearing local bookmarks never calls Fish')
    const res = await dispatch(web, '/fish-tts/synthesize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Bookmarked voice regression' }),
    })
    assert.equal(res.status, 200)
    assert.ok(res.body.startsWith('RIFF'))
    assert.equal(calls, 1)
    failClosed.assertNoPendingInterceptors()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

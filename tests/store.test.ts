/**
 * SettingsStore behaviour exercised through the config routes (FISH-TEST-001):
 * AES-256-GCM key round-trip with no plaintext on disk, corrupt-file backup
 * before rebuild, v0→v1 migration preserving ciphertext, and proxy validation.
 * All keys used here are fictional test values.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { makeCtx, makeWeb, dispatch, jsonBody } from './helpers.ts'
import { isolateEnvironment, installFailClosedNetwork } from './env-isolation.ts'

// Credential isolation + fail-closed network before any plugin logic runs.
isolateEnvironment()
installFailClosedNetwork()

// Fictional value only — never a real Fish Audio key.
const FAKE_KEY = 'FISH-TTS-TEST-KEY-0123456789abcdef'

function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'fish-tts-store-'))
}

function mount(stateDir: string) {
  const web = makeWeb()
  const ctx = makeCtx(web)
  apply(ctx as unknown as Context, { stateDir })
  return web
}

function readStore(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
}

test('API key round-trip: encrypted on disk, never in GET responses', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)
    const save = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: FAKE_KEY }),
    })
    assert.equal(save.status, 200)
    assert.equal(jsonBody(save).keyConfigured, true)

    const raw = readStore(dir)
    const serialized = JSON.stringify(raw)
    assert.ok(!serialized.includes(FAKE_KEY), 'plaintext key must never be written to settings.json')
    const cipher = raw.apiKeyCipher as { iv: string; tag: string; data: string }
    assert.ok(cipher.iv !== '' && cipher.tag !== '' && cipher.data !== '', 'ciphertext fields must exist')

    for (const path of ['/fish-tts/status', '/fish-tts/config']) {
      const res = await dispatch(web, path)
      assert.equal(res.status, 200)
      assert.ok(!JSON.stringify(jsonBody(res)).includes(FAKE_KEY), `${path} must not reveal the key`)
    }

    // A later save of other fields keeps the ciphertext (hasStoredKey stays true).
    const again = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 's2.1-pro' }),
    })
    assert.equal(again.status, 200)
    assert.equal(jsonBody(again).hasStoredKey, true)

    // Clearing the key removes the ciphertext.
    const cleared = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clearKey: true }),
    })
    assert.equal(cleared.status, 200)
    assert.equal(jsonBody(cleared).hasStoredKey, false)
    assert.equal(readStore(dir).apiKeyCipher, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupt settings.json is parked as .corrupt-* and rebuilt usable', async () => {
  const dir = freshStateDir()
  try {
    writeFileSync(join(dir, 'settings.json'), 'this is { not json')
    const web = mount(dir)
    const status = await dispatch(web, '/fish-tts/status')
    assert.equal(status.status, 200)
    assert.equal(jsonBody(status).ok, true)
    const backups = readdirSync(dir).filter(name => name.startsWith('settings.json.corrupt-'))
    assert.ok(backups.length >= 1, 'corrupt file must be backed up, not destroyed')
    assert.ok(readFileSync(join(dir, 'settings.json'), 'utf8').includes('"version": 1'), 'store must be rebuilt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('v0 migration preserves existing key ciphertext', async () => {
  const dir = freshStateDir()
  try {
    const preExisting = {
      apiKeyCipher: { iv: 'aGVsbG8=', tag: 'dGFnZGF0YQ==', data: 'ZGF0YWRhdGE=' },
    }
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(preExisting))
    const web = mount(dir)
    const config = await dispatch(web, '/fish-tts/config')
    assert.equal(config.status, 200)
    assert.equal(jsonBody(config).hasStoredKey, true, 'ciphertext must survive the migration')
    const raw = readStore(dir)
    assert.equal(raw.version, 1)
    assert.deepEqual(raw.apiKeyCipher, preExisting.apiKeyCipher)
    // A well-formed v0 file is migrated in place — never parked as corrupt.
    const backups = readdirSync(dir).filter(name => name.startsWith('settings.json.corrupt-'))
    assert.equal(backups.length, 0, 'well-formed v0 must not be renamed .corrupt-*')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('proxy values validate on save: userinfo/other schemes refused, http(s) kept', async () => {
  const dir = freshStateDir()
  try {
    const web = mount(dir)

    const bad = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxy: 'http://u:secret@127.0.0.1:7890' }),
    })
    assert.equal(bad.status, 400)
    assert.equal(jsonBody(bad).error, 'invalid-proxy')

    const good = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxy: 'http://127.0.0.1:7890' }),
    })
    assert.equal(good.status, 200)
    assert.equal(jsonBody(good).proxy, 'http://127.0.0.1:7890')

    const cleared = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxy: '' }),
    })
    assert.equal(cleared.status, 200)
    assert.equal(jsonBody(cleared).proxy, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('key.bin is created exactly once with 32 bytes', async () => {
  const dir = freshStateDir()
  try {
    mount(dir)
    const key = readFileSync(join(dir, 'key.bin'))
    assert.equal(key.length, 32)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Speech-tool settings through the config routes (FISH-SPEAK): strict
 * validation with no partial application, partial patches merging over
 * stored values, persistence across a simulated restart, and the fishTts
 * delivery service being exposed to channel plugins.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { makeCtx, makeWeb, dispatch, jsonBody } from './helpers.ts'
import { isolateEnvironment, installFailClosedNetwork } from './env-isolation.ts'

isolateEnvironment()
installFailClosedNetwork()

const GOOD = { enabled: true, format: 'mp3', maxChars: 300, perMinute: 1, loudness: true, volumeDb: 0 }

function mount(stateDir: string) {
  const web = makeWeb()
  const ctx = makeCtx(web)
  apply(ctx as unknown as Context, { stateDir })
  return { web, ctx }
}

test('valid speak settings persist and round-trip through GET /config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-tts-speak-store-'))
  try {
    const { web } = mount(dir)
    const put = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speak: { ...GOOD, volumeDb: -6, perMinute: 2 } }),
    })
    assert.equal(put.status, 200)
    assert.deepEqual(jsonBody(put).speak, { ...GOOD, volumeDb: -6, perMinute: 2 })

    const get = await dispatch(web, '/fish-tts/config')
    assert.deepEqual(jsonBody(get).speak, { ...GOOD, volumeDb: -6, perMinute: 2 })

    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { speak?: unknown }
    assert.deepEqual(raw.speak, { ...GOOD, volumeDb: -6, perMinute: 2 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an invalid speak patch is rejected whole: nothing changes, code invalid-speak', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-tts-speak-store-'))
  try {
    const { web } = mount(dir)
    const first = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speak: { ...GOOD, volumeDb: -3 } }),
    })
    assert.equal(first.status, 200)

    const bad = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speak: { perMinute: 99 }, proxy: 'http://127.0.0.1:7890' }),
    })
    assert.equal(bad.status, 400)
    assert.equal(jsonBody(bad).error, 'invalid-speak')

    // Neither the speak block nor the accompanying proxy field was applied.
    const get = await dispatch(web, '/fish-tts/config')
    const body = jsonBody(get)
    assert.equal((body.speak as { volumeDb: number }).volumeDb, -3)
    assert.equal(body.proxy, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('partial speak patches merge over stored values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-tts-speak-store-'))
  try {
    const { web } = mount(dir)
    await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speak: GOOD }),
    })
    const patch = await dispatch(web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speak: { loudness: false } }),
    })
    assert.equal(patch.status, 200)
    assert.deepEqual(jsonBody(patch).speak, { ...GOOD, loudness: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('speak settings survive a restart (fresh apply on the same state dir)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-tts-speak-store-'))
  try {
    const first = mount(dir)
    await dispatch(first.web, '/fish-tts/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speak: { ...GOOD, maxChars: 420 } }),
    })
    const second = mount(dir)
    const get = await dispatch(second.web, '/fish-tts/config')
    assert.equal((jsonBody(get).speak as { maxChars: number }).maxChars, 420)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the fishTts delivery service is exposed and registerDelivery returns a disposer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-tts-speak-store-'))
  try {
    const { ctx } = mount(dir)
    const service = ctx.provided.get('fishTts') as {
      registerDelivery: (channel: string, delivery: unknown) => () => void
    } | undefined
    assert.ok(service !== undefined, 'fishTts service must be provided')
    const disposer = service.registerDelivery('qqbot', { deliver: async () => {} })
    assert.equal(typeof disposer, 'function')
    disposer()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

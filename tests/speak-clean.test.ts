/**
 * Speech-line processing contract (FISH-SPEAK): Fish bracket tags survive
 * cleaning VERBATIM — a channel-side cleaner once stripped the brackets from
 * `[soft]` and Fish read the bare word aloud, which is the incident class
 * this suite pins. Also covers unknown-tag dropping, markdown/URL/emoji
 * removal, and the saved-voice resolution rules.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanSpeechText, dropUnknownTags, resolveSpeakVoice, normalizeSpeakSettings, normalizeSpeakPatch, DEFAULT_SPEAK_SETTINGS, SPEECH_TAGS, SPEAK_MIME } from '../src/speak.ts'
import type { SavedVoice } from '../src/voices.ts'

test('known emotion and sound tags pass through verbatim', () => {
  for (const tag of SPEECH_TAGS) {
    const line = `（小声）[${tag}] 你好呀`
    assert.equal(cleanSpeechText(line), `（小声）[${tag}] 你好呀`, `tag [${tag}] must not be touched`)
    assert.equal(dropUnknownTags(cleanSpeechText(line)), `（小声）[${tag}] 你好呀`)
  }
})

test('brackets are never stripped as markdown symbols', () => {
  // The exact incident: a symbol set containing [ ] turned [soft] into soft.
  const cleaned = cleanSpeechText('[soft] 晚安，做个好梦 *')
  assert.ok(cleaned.includes('[soft]'), `[soft] must survive: ${cleaned}`)
  assert.ok(!cleaned.includes('*'))
})

test('chinese-parenthesis asides pass through untouched', () => {
  const line = '（尾巴晃来晃去）来啦（小声嘀咕）'
  assert.equal(cleanSpeechText(line), line)
  assert.equal(dropUnknownTags(line), line)
})

test('unknown short bracketed tokens are dropped, not read aloud', () => {
  assert.equal(dropUnknownTags(cleanSpeechText('[happy] 你好')), '你好')
  // case-insensitive keep for documented tags
  assert.ok(dropUnknownTags('[Angry] 哼').includes('[Angry]'))
  // CJK bracketed spans and citations are content — never dropped
  const content = '参考 [见附录第三节的表格说明] 这一节'
  assert.ok(dropUnknownTags(content).includes('[见附录第三节的表格说明]'))
  assert.ok(dropUnknownTags('见 [1] 与 [注2]').includes('[1]'))
  // English-tag-shaped unknowns are the incident class — dropped
  assert.equal(dropUnknownTags('[excitedly] 好'), '好')
})

test('markdown links keep the label, URLs and code disappear', () => {
  assert.equal(cleanSpeechText('看[这篇文档](https://example.com/a)就行'), '看这篇文档就行')
  assert.equal(cleanSpeechText('去 https://example.com/x?q=1 看看'), '去 看看')
  assert.equal(cleanSpeechText('跑一下 ```py\nprint(1)\n``` 看看'), '跑一下 看看')
  assert.equal(cleanSpeechText('输入 `npm run build` 即可'), '输入 即可')
  assert.equal(cleanSpeechText('![截图](https://example.com/i.png) 好看'), '好看')
})

test('a markdown link is only unwrapped with a URL target, so tags stay safe', () => {
  // `[tag](不是链接)` must not eat the tag brackets.
  const line = '[soft]（悄悄说）'
  assert.ok(cleanSpeechText(line).includes('[soft]'))
  // The incident replay: a tag wearing link syntax must NOT become a bare word.
  const linked = cleanSpeechText('[soft](https://example.com) 晚安')
  assert.ok(linked.includes('[soft]'), `tag must keep brackets: ${linked}`)
  assert.ok(!linked.includes('example.com'))
  assert.equal(dropUnknownTags(linked), linked)
})

test('emoji, variation selectors and joiners are removed', () => {
  // Each emoji collapses to one space; the collapse pass then trims edges.
  assert.equal(cleanSpeechText('好😀好👍'), '好 好')
  assert.equal(cleanSpeechText('好\uFE0F好\u200D好'), '好 好 好')
})

test('whitespace collapses and empty results are detectable', () => {
  assert.equal(cleanSpeechText('  a\n\nb\tc  '), 'a b c')
  assert.equal(cleanSpeechText('```\n```'), '')
})

test('voice resolution: saved id, saved name (case-insensitive), raw id, default', () => {
  const voices: SavedVoice[] = [
    { id: 'ref-abc123', name: '温柔旁白', note: '' },
    { id: 'ref-def456', name: 'Cheerful', note: '' },
  ]
  assert.equal(resolveSpeakVoice('温柔旁白', voices, 'ref-default')?.voice, 'ref-abc123')
  assert.equal(resolveSpeakVoice('cheerful', voices, 'ref-default')?.voice, 'ref-def456')
  assert.equal(resolveSpeakVoice('ref-abc123', voices, 'ref-default')?.voice, 'ref-abc123')
  assert.deepEqual(resolveSpeakVoice('raw-ref-999', voices, 'ref-default'), { voice: 'raw-ref-999', from: 'raw' })
  assert.deepEqual(resolveSpeakVoice('raw-ref-999', voices, 'ref-default'), { voice: 'raw-ref-999', from: 'raw' })
  assert.deepEqual(resolveSpeakVoice('', voices, 'ref-default'), { voice: 'ref-default', from: 'default' })
  assert.equal(resolveSpeakVoice(undefined, voices, ''), null)
  assert.equal(resolveSpeakVoice(42, voices, 'ref-default')?.from, 'default')
})

test('speak settings: whole-object validation is strict, patch is partial', () => {
  const good = { enabled: true, format: 'mp3', maxChars: 300, perMinute: 1, loudness: true, volumeDb: 0 }
  assert.deepEqual(normalizeSpeakSettings(good), DEFAULT_SPEAK_SETTINGS)
  assert.equal(normalizeSpeakSettings({ ...good, format: 'silk' }), null)
  assert.equal(normalizeSpeakSettings({ ...good, maxChars: 10 }), null)
  assert.equal(normalizeSpeakSettings({ ...good, perMinute: -1 }), null)
  assert.equal(normalizeSpeakSettings({ ...good, volumeDb: 21 }), null)
  assert.equal(normalizeSpeakSettings('x'), null)
  assert.equal(normalizeSpeakSettings(null), null)

  assert.deepEqual(normalizeSpeakPatch({ volumeDb: -6 }), { volumeDb: -6 })
  assert.deepEqual(normalizeSpeakPatch({}), {})
  assert.equal(normalizeSpeakPatch({ enabled: 'yes' }), null)
  assert.equal(normalizeSpeakPatch({ maxChars: 1.5 }), null)
  assert.equal(normalizeSpeakPatch(7), null)
})

test('mime table covers every allowed format', () => {
  for (const format of ['mp3', 'wav', 'opus']) {
    assert.match(SPEAK_MIME[format], /^audio\//)
  }
})

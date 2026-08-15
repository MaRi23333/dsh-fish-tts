/**
 * Text-cleaning tests (FISH-TEST-001): cleanForTts must map un-speakable
 * tokens to locale-specific placeholders and strip markdown syntax.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanForTts, REPL_EN, REPL_ZH } from '../src/client/tts.ts'

test('replacements match the locale dictionaries', () => {
  assert.equal(REPL_EN.link, 'link')
  assert.equal(REPL_EN.path, 'path')
  assert.equal(REPL_EN.id, 'id')
  assert.equal(REPL_EN.code, 'code')
  assert.equal(REPL_EN.codeBlock, 'code block omitted')
  assert.equal(REPL_ZH.link, '链接')
  assert.equal(REPL_ZH.path, '路径')
  assert.equal(REPL_ZH.id, '编号')
  assert.equal(REPL_ZH.code, '长代码')
  assert.equal(REPL_ZH.codeBlock, '代码块，已省略')
})

test('English: URLs, paths, ids and long tokens become placeholders', () => {
  const out = cleanForTts(
    'See https://example.com/a/b?q=1, path C:\\Users\\me\\file.txt, uuid 123e4567-e89b-12d3-a456-426614174000, hex abcdef0123456789abcdef0123456789, b64 aGVsbG9Xb3JsZFRoaXNJc0FUb2tlbkZvclRlc3Q=',
    REPL_EN,
  )
  assert.ok(out.includes('See link'))
  assert.ok(!out.includes('https://'))
  assert.ok(!out.includes('C:\\Users'), 'windows path must be replaced')
  assert.ok(out.includes('path'), 'path placeholder must remain')
  assert.ok(!out.includes('123e4567-e89b-12d3-a456-426614174000'))
  assert.ok(!out.includes('abcdef0123456789abcdef0123456789'), 'long hex token must be replaced')
  assert.ok(!out.includes('aGVsbG9Xb3JsZFRoaXNJc0FUb2tlbkZvclRlc3Q='), 'base64 token must be replaced')
  assert.ok(out.includes('id'), 'id placeholder must remain for uuid/hex')
  assert.ok(out.includes('code'), 'code placeholder must remain for base64 token')
})

test('Chinese: same tokens become Chinese placeholders', () => {
  const out = cleanForTts(
    '看 https://example.com/x 和 C:\\路径\\文件.txt，UUID 123e4567-e89b-12d3-a456-426614174000',
    REPL_ZH,
  )
  assert.ok(out.includes('链接'))
  assert.ok(out.includes('路径'))
  assert.ok(out.includes('编号'))
  assert.ok(!out.includes('https://'))
  assert.ok(!out.includes('123e4567-e89b-12d3-a456-426614174000'))
})

test('code fences are omitted, inline code keeps its text', () => {
  const fenced = cleanForTts('before\n```js\nconst a = 1\n```\nafter', REPL_EN)
  assert.ok(fenced.includes('before'))
  assert.ok(fenced.includes('after'))
  assert.ok(!fenced.includes('const a = 1'))
  assert.ok(fenced.includes('code block omitted'))

  const inline = cleanForTts('run `pnpm install` now', REPL_EN)
  assert.ok(inline.includes('pnpm install'))
})

test('markdown syntax is stripped: headings, lists, quotes, emphasis, links, images, html', () => {
  const input = [
    '# Title',
    '',
    '> quoted line',
    '',
    '- item one',
    '- item two',
    '',
    '1. numbered one',
    '',
    '**bold** and *italic* and ~~strike~~',
    '',
    '![alt](img.png) [label](https://x.dev/page)',
    '',
    '<b>html</b> tail',
  ].join('\n')
  const out = cleanForTts(input, REPL_EN)
  assert.ok(!out.includes('#'))
  assert.ok(!out.includes('> quoted'))
  assert.ok(!out.includes('- item'))
  assert.ok(!out.includes('1. numbered'))
  assert.ok(!out.includes('**'))
  assert.ok(!out.includes('![alt]'))
  assert.ok(!out.includes('https://x.dev'))
  assert.ok(out.includes('label'))
  assert.ok(!out.includes('<b>'))
  assert.ok(out.includes('html tail'))
})

test('whitespace is collapsed and output trimmed', () => {
  const out = cleanForTts('  a    b\n\n\n\nc  ', REPL_EN)
  assert.equal(out, 'a b\nc')
})

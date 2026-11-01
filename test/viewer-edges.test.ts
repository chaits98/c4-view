/**
 * The viewer page's less-travelled paths: the root with crumbs and no docs, an expanded page whose docs
 * must be re-keyed, the zoom presets, and a model that is not a lens at all. Each one is a page a user
 * can actually open, which is why they are tested on the HTML rather than on internals.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseModel } from '../src/model.ts'
import { viewerPage } from '../src/viewer-page.ts'

const lens = () => parseModel(JSON.parse(readFileSync(new URL('../examples/lens.json', import.meta.url), 'utf8')) as unknown)

test('the root page has no link crumbs, only the current one', () => {
  const html = viewerPage(lens(), '')
  assert.match(html, /<h1 class="c4-crumb-h1" aria-current="page">/)
  assert.ok(!html.includes('<a href="/d/lens/">'), 'nothing above the root to link to')
})

test('a deep level links every crumb above it', () => {
  const raw = JSON.parse(readFileSync(new URL('../fixtures/droid.json', import.meta.url), 'utf8')) as Record<string, any>
  const model = parseModel(raw)
  const deep = model.levels.find((l) => l.path.split('/').length > 2)
  assert.ok(deep, 'the fixture has a deep level')
  const html = viewerPage(model, deep.path)
  assert.ok(html.includes('<a href="/d/droid'), 'crumbs above the current one are links')
  assert.match(html, /<h1 class="c4-crumb-h1" aria-current="page">/)
})

test('a root level with no title says Overview rather than an empty crumb', () => {
  const bare = parseModel({
    id: 'bare',
    title: 'Bare',
    levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }],
  } as never)
  assert.match(viewerPage(bare, ''), />Overview</)
})

test('docs on an expanded page are re-keyed to the drawn ids, node and edge alike', () => {
  const docs = {
    nodes: { a: '<p>door</p>', b: '<p>middle</p>' },
    edges: { 'a->b': '<p>the hop</p>', 'user->a': '<p>from outside</p>' },
  }
  const html = viewerPage(lens(), 'context1', null, 'auto', docs)
  assert.match(html, /id="c4-docs"/)
  assert.ok(html.includes('context1/a'), 'node docs are prefixed')
  assert.ok(html.includes('context1/a->context1/b'), 'edge docs are prefixed on both ends')
})

test('an empty doc set emits no script block at all', () => {
  const html = viewerPage(lens(), '', null, 'auto', { nodes: {}, edges: {} })
  assert.ok(!html.includes('id="c4-docs"'), 'nothing to say, nothing in the page')
})

test('an explicit zoom wins over the wide-drawing default', () => {
  const html = viewerPage(lens(), 'context1', '2')
  assert.match(html, /zoom=2/)
})

test('a model with no lens levels answers the drill link with a note, not a 404', () => {
  const model = parseModel(
    JSON.parse(readFileSync(new URL('../examples/shop.json', import.meta.url), 'utf8')) as unknown,
  )
  const html = viewerPage(model, '')
  assert.ok(html.length > 1000, 'the page renders')
})

test('the page keeps its one template: the shell comes from public/viewer.html, not a copy in code', () => {
  const shell = readFileSync(new URL('../public/viewer.html', import.meta.url), 'utf8')
  const marker = shell.split('\n').find((line) => line.includes('id="c4-stage"'))
  assert.ok(marker, 'the template has a stage')
  assert.ok(viewerPage(lens(), '').includes('id="c4-stage"'), 'and the page carries it through')
})

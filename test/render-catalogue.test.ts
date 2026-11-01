/**
 * One model, drawn every way the product draws it: the SVG, the page, the text version, the card.
 *
 * A single fixture that carries every optional feature at once — identity, tech, a boundary group, a
 * specified flow, an untitled level, a node with neither tech nor desc — because the branches being
 * covered here are all "this field may be absent", and a fixture per branch would say less.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseModel } from '../src/model.ts'
import { indexPage } from '../src/index-page.ts'
import { viewerPage } from '../src/viewer-page.ts'
import { renderModel } from '../src/render.ts'

const model = parseModel({
  id: 'catalogue',
  title: 'Catalogue <&>',
  levels: [
    {
      path: '',
      nodes: [
        { id: 'svc', label: 'Service', subtype: 'system', tech: 'Node 22', desc: 'does the work', identity: 'team-payments' },
        { id: 'plain', label: 'Plain', subtype: 'system' },
        { id: 'db', label: 'Db', subtype: 'database', tech: 'Postgres' },
      ],
      edges: [
        { from: 'svc', to: 'db', label: 'writes', style: 'flow' },
        { from: 'plain', to: 'svc', style: 'dep' },
      ],
      groups: [{ id: 'g', label: 'Backend', members: ['svc', 'db'] }],
      flow: ['svc->db'],
    },
    { path: 'svc', nodes: [{ id: 'inner', label: 'Inner', subtype: 'system' }], edges: [] },
  ],
})

test('the svg carries the identity line, the group box and the flow order', () => {
  const level = renderModel(model).levels[0]
  assert.match(level.svg, /team-payments/, 'identity is drawn when present')
  assert.match(level.svg, /Backend/, 'a boundary group is labelled')
  assert.match(level.svg, /data-flow="1"/, 'the flow marks its first edge')
  assert.ok(level.audit.ok, `the fixture is audit-clean: ${JSON.stringify(level.audit)}`)
})

test('a level with no edges says so instead of drawing an empty list', () => {
  const html = viewerPage(model, 'svc')
  assert.ok(html.includes('Flows (0)'), 'the count is honest')
  assert.ok(html.includes('<li>none on this level</li>'), 'and the list says none')
})

test('an unknown level is refused before a page is built', () => {
  // the route 404s first; this is the guard behind it, and it must name the level it could not find
  assert.throws(() => viewerPage(model, 'no/such/level'), /no level "no\/such\/level"/)
})

test('a node with no tech and no desc keeps its line clean', () => {
  const html = viewerPage(model, '')
  assert.ok(html.includes('<strong>Plain</strong> <code>plain</code></li>'), 'no dangling separator')
})

test('the grid escapes a title that contains markup', () => {
  const html = indexPage([
    { id: 'catalogue', title: 'Catalogue <&>', levels: ['', 'svc'], updated: '2026-11-01T00:00:00.000Z', svg: '<svg></svg>', ok: true, nodes: 3, flows: 2, wide: false },
  ])
  assert.match(html, /Catalogue &lt;&amp;&gt;/, 'escaped, not injected')
  assert.match(html, /1 diagram</, 'one diagram is not "1 diagrams"')
  assert.match(html, /audit clean/, 'and the badge reads as words')
})

test('a store path that does not exist is a failed requirement, not a crash', async () => {
  const { checks } = await import('../src/doctor.ts')
  const rows = checks(join(mkdtempSync(join(tmpdir(), 'c4v-none-')), 'missing'))
  const store = rows.find((row) => row.name === 'store')
  assert.ok(store, 'the store check always reports')
  assert.equal(store.required, true, 'and it is a requirement, not a note')
})

test('every edge style draws its own stroke, and a model with no flow carries no step', () => {
  const styled = parseModel({
    id: 'styles',
    title: 'Styles',
    levels: [{
      path: '',
      nodes: [{ id: 'a', label: 'A', subtype: 'system' }, { id: 'b', label: 'B', subtype: 'system' }],
      edges: [
        { from: 'a', to: 'b', style: 'flow' },
        { from: 'b', to: 'a', style: 'dep' },
      ],
    }],
  })
  const svg = renderModel(styled).levels[0].svg
  assert.match(svg, /stroke-dasharray/, 'a dependency is dashed, a flow is not')
  // a level with no edges at all has nothing to number
  const bare = parseModel({ id: 'bare', title: 'Bare', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }] })
  assert.ok(!renderModel(bare).levels[0].svg.includes('data-flow='), 'no edges, no step attribute')
})

test('a level with no title still gets one in the svg', () => {
  const untitled = parseModel({ id: 'untitled', title: 'Untitled', levels: [{ path: 'x', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }] })
  assert.match(renderModel(untitled, 'x').levels[0].svg, /<title>x<\/title>/, 'the path names it when the title is blank')
})

test('the grid shows a failing card, a wide card and a single card correctly', () => {
  const entry = (over: Record<string, unknown>) => ({ id: 'x', title: 'X', levels: [''], updated: '2026-11-01T00:00:00.000Z', svg: '<svg></svg>', ok: true, nodes: 1, flows: 0, wide: false, ...over })
  const one = indexPage([entry({})])
  assert.match(one, /1 diagram</, 'singular')
  const bad = indexPage([entry({ id: 'bad', ok: false })])
  assert.match(bad, /audit failed/, 'a failing diagram says failed, not clean')
  assert.match(bad, /class="badge t-label-m bad"/, 'and the badge carries the state as a class')
  const wide = indexPage([entry({ wide: true })])
  assert.match(wide, /class="thumb is-wide"/, 'a cropped card is marked')
  for (const theme of ['auto', 'light', 'dark'] as const) {
    assert.match(indexPage([entry({})], theme), new RegExp(`href="/\\?theme=${theme}"[^>]*aria-current`), `${theme} is marked current`)
  }
})

test('a breadcrumb skips a level segment the model does not have', () => {
  // a deep level whose parent was never authored: the trail must not invent a link for it
  const deep = parseModel({ id: 'deep', title: 'Deep', levels: [
    { path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] },
    { path: 'x/y', title: 'Inner', nodes: [{ id: 'b', label: 'B', subtype: 'system' }], edges: [] },
  ] })
  const html = viewerPage(deep, 'x/y')
  assert.ok(html.includes('>Inner<'), 'the current level is named')
  assert.ok(!html.includes('/d/deep/x"'), 'the missing parent is not a link')
})

test('a card whose svg has no viewBox is not called wide', () => {
  const flat = indexPage([{ id: 'x', title: 'X', levels: [''], updated: '2026-11-01T00:00:00.000Z', svg: '<svg></svg>', ok: true, nodes: 1, flows: 0, wide: false }])
  assert.ok(!flat.includes('is-wide'), 'no width, no ratio, no crop')
})

test('a level with a path but no title is named by its path, in the crumbs and the select', () => {
  const bare = parseModel({ id: 'bare-levels', title: 'Bare', levels: [
    { path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] },
    { path: 'api/v1', nodes: [{ id: 'b', label: 'B', subtype: 'system' }], edges: [] },
  ] })
  const html = viewerPage(bare, 'api/v1')
  // the select is a tree now: indented by depth, prefixed with the C4 level, path in the tooltip
  assert.ok(/<option value="api\/v1" title="api\/v1" selected>/.test(html), 'the select names the level')
  assert.ok(html.includes('&#160;&#160;&#160;&#160;&#160;&#160;'), 'indented by depth')
  assert.ok(html.includes('C3 ·'), 'the C4 level is part of the label')
  assert.ok(
    html.includes('<h1 class="c4-crumb-h1" aria-current="page">api/v1</h1>'),
    'and so does the crumb, as the page heading and the current page',
  )
})

test('a node with a desc but no tech keeps the desc line', () => {
  const one = parseModel({ id: 'desc-only', title: 'Desc', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system', desc: 'does the thing' }], edges: [] }] })
  assert.match(viewerPage(one, ''), /A<\/strong> <code>a<\/code> — does the thing/, 'no dangling separator, no empty tech')
})

test('an edge with no label still appears in the text version, without a dash', () => {
  const one = parseModel({ id: 'unlabelled', title: 'U', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }, { id: 'b', label: 'B', subtype: 'system' }], edges: [{ from: 'a', to: 'b' }] }] })
  assert.ok(viewerPage(one, '').includes('<li>A → B</li>'), 'the flow is listed with no trailing dash')
})

test('identity and tech are drawn independently', () => {
  const model2 = parseModel({ id: 'halves', title: 'Halves', levels: [{ path: '', nodes: [
    { id: 'a', label: 'Tech only', subtype: 'system', tech: 'Node 22' },
    { id: 'b', label: 'Owner only', subtype: 'system', identity: 'team-payments' },
  ], edges: [{ from: 'a', to: 'b' }] }] })
  const svg = renderModel(model2).levels[0].svg
  assert.match(svg, /Node 22/, 'tech is drawn when it is the only small line')
  assert.match(svg, /team-payments/, 'identity is drawn when it is the only small line')
})

test('sorting by title falls back to the id when two titles match', () => {
  const base = { levels: [''], updated: '2026-11-01T00:00:00.000Z', svg: '<svg></svg>', ok: true, nodes: 1, flows: 0, wide: false }
  const html = indexPage([{ ...base, id: 'b', title: 'Same' }, { ...base, id: 'a', title: 'Same' }], 'auto', 'title')
  assert.ok(html.indexOf('/d/a"') < html.indexOf('/d/b"'), 'the id decides, so the order is stable')
})

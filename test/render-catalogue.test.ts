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

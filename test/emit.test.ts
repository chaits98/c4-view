/**
 * The emitter's contract: well-formed, deterministic, escaped, complete.
 * Fixtures are inline literals; boxes come from the real `measureNode`, so the
 * text a test looks for is the text the emitter had to place.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { lineHeight, measure } from '../src/metrics.ts'
import { measureNode } from '../src/layout/measure-node.ts'
import { DEFAULT_LAYOUT, SUBTYPE_KIND, type Box, type LayoutConfig, type LevelSpec, type NodeSpec, type Placed, type PlacedItem, type Route, type Routed, type Subtype } from '../src/types.ts'
import { DARK } from '../src/theme.ts'
import { shapeOf, shapePath, shapeTextInset, type ShapeId } from '../src/svg/shapes.ts'
import { emit } from '../src/svg/emit.ts'

const cfg: LayoutConfig = DEFAULT_LAYOUT
const EVIL = `<script>alert(1)</script>&"'`

const NODES: NodeSpec[] = [
  { id: 'web', label: 'Web app', subtype: 'system', identity: 'C4-1', tech: 'React' },
  { id: 'api', label: 'Orders API', subtype: 'api-gateway', desc: 'gateway for <orders> & "billing"' },
  { id: 'db', label: 'Orders DB', subtype: 'database', identity: 'C4-2' },
  { id: 'evil', label: EVIL, subtype: 'function' },
]

const LEVEL: LevelSpec = {
  path: '',
  title: 'Store & <view>',
  nodes: NODES,
  edges: [
    { from: 'web', to: 'api', label: 'calls', style: 'flow' },
    { from: 'api', to: 'db', label: EVIL, style: 'dep' },
  ],
  groups: [{ id: 'g1', label: EVIL, members: ['db'] }],
}

interface Fixture { placed: Placed; routed: Routed }

function fixture(): Fixture {
  const items = new Map<string, PlacedItem>()
  const boxes = new Map<string, Box>()
  let y = 0
  let w = 0
  NODES.forEach((node, index) => {
    const t = measureNode(node, cfg, measure)
    const h = Math.max(t.h, cfg.portGap * 2)
    const item: PlacedItem = { id: node.id, rank: 0, index, w: t.w, h, dummy: false, x: 0, y }
    items.set(node.id, item)
    boxes.set(node.id, { x: 0, y, w: t.w, h })
    w = Math.max(w, t.w)
    y += h + cfg.nodeGap
  })
  const size = { w, h: y - cfg.nodeGap }
  const db = boxes.get('db') ?? { x: 0, y: 0, w: 10, h: 10 }
  const placed: Placed = {
    items,
    chains: [
      { key: 'web->api', from: 'web', to: 'api', items: ['web', 'api'], label: 'calls', style: 'flow', backward: false },
      { key: 'api->db', from: 'api', to: 'db', items: ['api', 'db'], label: EVIL, style: 'dep', backward: false },
    ],
    boxes,
    groups: [{ id: 'g1', label: EVIL, box: { x: db.x - 16, y: db.y - 38, w: db.w + 32, h: db.h + 54 } }],
    size,
  }
  const routes: Route[] = [
    {
      key: 'web->api',
      pts: [{ x: w, y: 20 }, { x: w + 40, y: 20 }, { x: w + 40, y: 160 }, { x: w + 80, y: 160 }],
      label: { text: 'calls', box: { x: w + 10, y: 40, w: 44, h: 18 } },
    },
    {
      key: 'api->db',
      pts: [{ x: w, y: 160 }, { x: w + 90, y: 160 }],
      label: { text: EVIL, box: { x: w + 20, y: 170, w: 120, h: 18 } },
    },
  ]
  return { placed, routed: { routes, size: { w: size.w + 120, h: size.h + 40 } } }
}

const { placed, routed } = fixture()
const svg = emit(placed, routed, LEVEL, cfg, DARK, { drill: new Map([['db', 'app/db']]) })

const count = (hay: string, needle: string): number => hay.split(needle).length - 1
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

test('one svg element, nothing around it', () => {
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.endsWith('</svg>'))
  assert.equal(count(svg, '<svg'), 1)
  assert.equal(count(svg, '<style'), 0)
})

test('every node, route and labelled route chip is emitted exactly once', () => {
  for (const node of NODES) assert.equal(count(svg, `data-id="${node.id}"`), 1, node.id)
  // one path per route, and (for a labelled route) one chip that names the same edge
  for (const route of routed.routes) {
    assert.equal(count(svg, `<path data-key="${esc(route.key)}"`), 1, route.key)
    if (route.label) assert.equal(count(svg, `<g data-chip="1" data-key="${esc(route.key)}">`), 1, `chip ${route.key}`)
  }
  const labelled = routed.routes.filter((r) => r.label).length
  assert.equal(count(svg, 'data-chip'), labelled)
  assert.equal(count(svg, '<path data-key'), routed.routes.length)
})

test('no NaN, undefined or [object Object] leaks into the output', () => {
  for (const bad of ['NaN', 'undefined', '[object Object]']) assert.equal(count(svg, bad), 0, bad)
})

test('every subtype maps to a shape and every shape path is closed and finite', () => {
  const ids: ShapeId[] = ['rect', 'rounded', 'stadium', 'subroutine', 'cylinder', 'circle', 'diamond', 'hexagon', 'parallelogram', 'trapezoid', 'trapezoidAlt', 'actor']
  const box: Box = { x: 4, y: 6, w: 120, h: 60 }
  for (const id of ids) {
    const d = shapePath(id, box)
    assert.ok(d.startsWith('M'), id)
    assert.ok(!d.includes('NaN'), id)
    assert.ok(d.endsWith('Z'), id)
  }
  for (const subtype of Object.keys(SUBTYPE_KIND) as Subtype[]) {
    const shape = shapeOf(subtype)
    assert.ok(ids.includes(shape), `${subtype} -> ${shape}`)
    assert.ok(!shapePath(shape, box).includes('NaN'), subtype)
  }
})

test('a caller with no options gets a plain drawing, not a broken one', () => {
  const bare = emit(placed, routed, LEVEL, cfg, DARK)
  assert.ok(bare.startsWith('<svg'))
  assert.ok(!bare.includes('data-drill'), 'no drill hint invented')
  assert.equal(count(bare, '<svg'), 1)
})

test('emission is byte-identical across calls', () => {
  const again = emit(placed, routed, LEVEL, cfg, DARK, { drill: new Map([['db', 'app/db']]) })
  assert.equal(again, svg)
})

test('viewBox covers the placed drawing', () => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  assert.ok(m)
  assert.ok(Number(m[1]) >= placed.size.w)
  assert.ok(Number(m[2]) >= placed.size.h)
})

test('untrusted text cannot break out of the markup', () => {
  assert.ok(!svg.includes('<script>'))
  assert.ok(svg.includes('&lt;script&gt;'))
  // each of the three untrusted sinks, checked in its own slice
  const nodeSlice = svg.slice(svg.indexOf('data-id="evil"'))
  assert.ok(nodeSlice.includes('&lt;script&gt;'))
  const chipSlices = svg.split('<g data-chip').slice(1).filter((s) => s.includes('&lt;script&gt;'))
  assert.equal(chipSlices.length, 1, 'edge label chip escaped')
  const groupSlice = svg.slice(svg.indexOf('data-group="g1"'))
  assert.ok(groupSlice.includes('&lt;script&gt;'), 'group label escaped')
})

test('each node draws only its own text inside its own group', () => {
  for (const node of NODES) {
    const start = svg.indexOf(`<g class="node" data-id="${node.id}"`)
    assert.ok(start >= 0, node.id)
    const slice = svg.slice(start, svg.indexOf('</g>', start))
    for (const line of measureNode(node, cfg, measure).lines) assert.ok(slice.includes(esc(line)), `${node.id}: ${line}`)
  }
})

test('every shape\'s box is big enough for the text band it declares', () => {
  // the defect this catches: a `person` box was measured without the head, so the third line
  // rendered 7.8px below the silhouette, and a `cylinder` wrote its id across the top ellipse
  const small = Math.max(9, cfg.fontSize - 2)
  for (const subtype of Object.keys(SUBTYPE_KIND) as Subtype[]) {
    const node: NodeSpec = { id: 'n', label: 'A label long enough to wrap one line', subtype, identity: 'SH-1', tech: 'Node 22' }
    const t = measureNode(node, cfg, measure)
    const inset = shapeTextInset(shapeOf(subtype), { x: 0, y: 0, w: t.w, h: t.h })
    const textH = lineHeight(small) * 2 + t.lines.length * lineHeight(cfg.fontSize)
    const bandH = t.h - inset.top - inset.bottom
    assert.ok(bandH >= textH, `${subtype}: band ${bandH.toFixed(1)} < text ${textH.toFixed(1)}`)
    const widest = Math.max(...t.lines.map((l) => measure.width(l, cfg.fontSize)))
    assert.ok(t.w - inset.left - inset.right >= widest, `${subtype}: width cannot hold the label`)
  }
})

test('actor and diamond text stays inside the shape silhouette', () => {
  // measured defect: a `person` node wrote its id on the head circle and the label across
  // the neck notch, 58.9px outside the filled silhouette
  const actor = measureNode({ id: 'p', label: 'Customer browser', subtype: 'person', tech: 'mobile' }, cfg, measure)
  const inset = shapeTextInset('actor', { x: 0, y: 0, w: actor.w, h: actor.h })
  assert.ok(inset.top >= 24, `actor text inset too small: ${inset.top}`)
  const diamond = shapeTextInset('diamond', { x: 0, y: 0, w: 200, h: 100 })
  assert.ok(diamond.left >= 30 && diamond.top >= 18, `diamond inset too small: ${JSON.stringify(diamond)}`)
})

test('a label that will not fit three lines is truncated with an ellipsis, not clipped', () => {
  const long = 'an extraordinarily long service name that keeps going past every limit'
  const t = measureNode({ id: 'x', label: `${long} ${long}`, subtype: 'system', identity: `owner ${long}`, tech: long }, DEFAULT_LAYOUT, measure)
  assert.equal(t.lines.length, 3, 'never more than three lines')
  assert.ok(t.lines[2].endsWith('…'), `the last line is marked as cut: ${t.lines[2]}`)
  assert.ok(t.identity?.endsWith('…') !== false, 'and so are the small lines when they are long')
})

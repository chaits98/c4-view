/**
 * Rows of columns: a strip too wide to read wraps, but only when wrapping keeps the picture as clean as the
 * single row was. These tests pin both halves of that rule and the routing the cross-row wires need.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT, type LevelSpec, type Model } from '../src/types.ts'
import { layoutLevel, renderLevel } from '../src/render.ts'
import { parseModel } from '../src/model.ts'
import { tokenLines } from '../src/cli.ts'
import { expandLevel } from '../src/expand.ts'
import { place } from '../src/layout/place.ts'
import { route } from '../src/layout/route.ts'
import { measure } from '../src/metrics.ts'

/** A straight chain of `n` boxes: the shape that gets wide fastest. */
function chain(n: number): LevelSpec {
  return {
    path: 'wide',
    title: 'Wide',
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, subtype: 'service-logic', tech: 'ts' })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: `step${i}`, style: 'flow' })),
    flow: Array.from({ length: n - 1 }, (_, i) => `n${i}->n${i + 1}`),
  } as LevelSpec
}

test('a chain wider than the budget wraps, and the cross-row wires stay out of the boxes', () => {
  const lv = chain(12)
  const { placed, routed, audit } = layoutLevel(lv, { ...DEFAULT_LAYOUT, rowWidth: 900 })
  const bands = placed.bands ?? []
  assert.ok(bands.length > 1, `wrapped into ${bands.length} row(s)`)
  assert.ok(routed.size.w <= 900, `the strip fits the budget (${routed.size.w})`)
  assert.equal(audit.wireNode, 0, 'no wire cuts a box, including on the way between rows')
  assert.equal(audit.nodeNode, 0)
  // rows never overlap: each one starts below the previous one's lowest box
  for (let i = 1; i < bands.length; i += 1) assert.ok(bands[i].top > bands[i - 1].bottom, 'rows are separated')
})

test('a strip that already fits keeps its single row', () => {
  const { placed } = layoutLevel(chain(4), { ...DEFAULT_LAYOUT, rowWidth: 4000 })
  assert.equal((placed.bands ?? []).length, 1)
})

test('no budget means no wrapping at all', () => {
  const { placed } = layoutLevel(chain(12), { ...DEFAULT_LAYOUT, rowWidth: 0 })
  assert.equal((placed.bands ?? []).length, 1)
})

test('wrapping is refused when it would cost more crossings than the width is worth', () => {
  // a hub: every box talks to the first one, so wrapping puts almost every wire across the gap
  const n = 10
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `h${i}`, label: `Hub ${i}`, subtype: 'service-logic', tech: 'x' }))
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: 'h0', to: `h${i + 1}`, label: 'calls', style: 'flow' }))
  const lv = { path: 'hub', nodes, edges } as unknown as LevelSpec
  const wide = layoutLevel(lv, { ...DEFAULT_LAYOUT, rowWidth: 900 })
  const flat = layoutLevel(lv, { ...DEFAULT_LAYOUT, rowWidth: 0 })
  assert.ok(wide.audit.crossingsPerEdge <= 1 || wide.audit.crossings <= flat.audit.crossings, 'a wrapped picture is never the messier one')
})

test('a row boundary is chosen per rank, not per item: no box is split across two rows', () => {
  const lv = chain(9)
  const { placed } = layoutLevel(lv, { ...DEFAULT_LAYOUT, rowWidth: 700 })
  const bandOfRank = new Map<number, Set<number>>()
  for (const it of placed.items.values()) {
    const set = bandOfRank.get(it.rank) ?? new Set<number>()
    set.add(it.band ?? 0)
    bandOfRank.set(it.rank, set)
  }
  for (const [rank, bands] of bandOfRank) assert.equal(bands.size, 1, `rank ${rank} lives in one row`)
})

test('a composed level wraps too, and its frame stays with its contents', () => {
  const model = parseModel({
    id: 'composed',
    title: 'Composed',
    levels: [
      { path: '', nodes: [{ id: 'wide', label: 'Wide', subtype: 'system' }], edges: [] },
      chain(8),
    ],
  } as unknown as Model)
  const expanded = expandLevel(model, 'wide').level
  const rendered = renderLevel(model, expanded)
  assert.equal(rendered.audit.wireNode, 0)
  assert.equal(rendered.audit.groupNode, 0, 'a frame never covers a stranger')
})

test('the token is printed to a terminal, and only its location to a log', () => {
  assert.deepEqual(tokenLines(null, true), [], 'no token, no line')
  assert.match(tokenLines('abc', true)[0], /token:\s+abc/, 'a human at a terminal gets it')
  const logged = tokenLines('abc', false)[0]
  assert.ok(!logged.includes('abc'), 'a service log does not')
  assert.match(logged, /not printed/)
})

test('a row of columns that names an id nothing placed is skipped, not thrown', () => {
  const ranked = {
    ranks: [['ghost']],
    items: new Map(),
    chains: [],
  } as unknown as Parameters<typeof place>[0]
  const lv = { path: '', nodes: [], edges: [] } as unknown as LevelSpec
  const p = place(ranked, lv, DEFAULT_LAYOUT, measure)
  assert.equal(p.items.size, 0)
  assert.equal((p.bands ?? []).length, 1)
})

test('a cross-row wire on a Placed with no band list still routes through the gap', () => {
  const items = new Map([
    ['a', { id: 'a', rank: 0, index: 0, w: 100, h: 40, dummy: false, x: 0, y: 0, band: 0 }],
    ['b', { id: 'b', rank: 1, index: 0, w: 100, h: 40, dummy: false, x: 0, y: 200, band: 1 }],
  ]) as unknown as Parameters<typeof route>[0]['items']
  const chains = [{ key: 'a->b', from: 'a', to: 'b', items: ['a', 'b'], style: 'flow', backward: false }]
  const placed = {
    items,
    chains,
    boxes: new Map([['a', { x: 0, y: 0, w: 100, h: 40 }], ['b', { x: 0, y: 200, w: 100, h: 40 }]]),
    groups: [],
    size: { w: 100, h: 240 },
  } as unknown as Parameters<typeof route>[0]
  const routed = route(placed, DEFAULT_LAYOUT, measure)
  assert.equal(routed.routes.length, 1)
  const ys = routed.routes[0].pts.map((p) => p.y)
  assert.ok(ys.some((y) => y > 40 && y < 200), 'the wire crosses the gap between the rows')

  // half a band list: the source's row is known, the target's is not — the fallback gap is used, not a crash
  const half = route({ ...placed, bands: [{ top: 0, bottom: 40, ranks: [0] }] } as unknown as Parameters<typeof route>[0], DEFAULT_LAYOUT, measure)
  assert.equal(half.routes.length, 1)
})

test('a level with no title is named by its path', () => {
  const model = parseModel({
    id: 'm',
    title: 'M',
    levels: [
      { path: '', nodes: [{ id: 'untitled', label: 'U', subtype: 'system' }], edges: [] },
      { path: 'untitled', nodes: [{ id: 'b', label: 'B', subtype: 'service-logic' }], edges: [] },
    ],
  } as unknown as Model)
  const lv = model.levels[1]
  assert.equal(renderLevel(model, lv).title, 'untitled')
})

test('a long edge that skips rows still gets its corridor (dummy items wrap with the rest)', () => {
  // n0 → n3 skips two columns, so the ranker inserts dummies; with wrapping they land on the right row
  const lv = {
    path: 'skip',
    nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: `N ${i}`, subtype: 'service-logic', tech: 'x' })),
    edges: [
      { from: 'n0', to: 'n1', style: 'flow' },
      { from: 'n1', to: 'n2', style: 'flow' },
      { from: 'n2', to: 'n3', style: 'flow' },
      { from: 'n3', to: 'n4', style: 'flow' },
      { from: 'n4', to: 'n5', style: 'flow' },
      { from: 'n0', to: 'n5', label: 'long', style: 'flow' },
      { from: 'n5', to: 'n6', style: 'flow' },
      { from: 'n6', to: 'n7', style: 'flow' },
    ],
  } as unknown as LevelSpec
  const { placed, audit } = layoutLevel(lv, { ...DEFAULT_LAYOUT, rowWidth: 700 })
  assert.ok([...placed.items.values()].some((it) => it.dummy), 'the long edge has dummies')
  assert.equal(audit.wireNode, 0)
})

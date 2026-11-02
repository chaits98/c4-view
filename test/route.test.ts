/**
 * The routing promise, proved: straight edges stay straight, jogs own a private
 * track inside their gutter, a long edge continues through its dummy, and no two
 * routes share a collinear segment.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Box, Chain, Placed, PlacedItem, Point, Route } from '../src/types.ts'
import { routeOf } from '../src/routes.ts'
import { DEFAULT_LAYOUT } from '../src/types.ts'
import { measure } from '../src/metrics.ts'
import { route } from '../src/layout/route.ts'

const cfg = DEFAULT_LAYOUT
const node = (id: string, rank: number, index: number, x: number, y: number, w = 100, h = 40): PlacedItem => ({
  id,
  rank,
  index,
  w,
  h,
  dummy: false,
  x,
  y,
})
const dummy = (id: string, rank: number, index: number, x: number, y: number, h = 19.2): PlacedItem => ({
  id,
  rank,
  index,
  w: 0,
  h,
  dummy: true,
  x,
  y,
})
const chain = (from: string, to: string, items: string[], label?: string, backward = false): Chain => ({
  key: `${from}->${to}`,
  from,
  to,
  items,
  style: 'flow',
  backward,
  ...(label ? { label } : {}),
})

function placedOf(items: PlacedItem[], chains: Chain[], w = 540): Placed {
  const boxes = new Map<string, Box>()
  for (const it of items) if (!it.dummy) boxes.set(it.id, { x: it.x, y: it.y, w: it.w, h: it.h })
  const h = Math.max(...items.map((it) => it.y + it.h))
  return { items: new Map(items.map((it) => [it.id, it])), chains, boxes, groups: [], size: { w, h } }
}

const verticals = (pts: Point[]): Array<{ x: number }> =>
  pts.slice(1).flatMap((p, i) => (Math.abs(p.x - pts[i].x) < 0.5 && Math.abs(p.y - pts[i].y) > 0.5 ? [{ x: p.x }] : []))

/** The audit's rule, inline: collinear overlap longer than 2px between two routes. */
function sharedSegments(routes: Route[]): number {
  interface Seg {
    h: boolean
    a: Point
    b: Point
  }
  const segs = routes.map((r) =>
    r.pts.slice(1).map((b, i): Seg => {
      const a = r.pts[i]
      return { h: Math.abs(a.y - b.y) < 0.5, a, b }
    }),
  )
  const span = (a: number, b: number, c: number, d: number): number =>
    Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d))
  let bad = 0
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      for (const x of segs[i]) {
        for (const y of segs[j]) {
          if (x.h !== y.h) continue
          if (x.h && Math.abs(x.a.y - y.a.y) <= 0.5 && span(x.a.x, x.b.x, y.a.x, y.b.x) > 2) bad += 1
          if (!x.h && Math.abs(x.a.x - y.a.x) <= 0.5 && span(x.a.y, x.b.y, y.a.y, y.b.y) > 2) bad += 1
        }
      }
    }
  }
  return bad
}

/** 5 edges over 3 ranks: two straights, two jogs, one long edge through a dummy. */
function spread(): Placed {
  const items = [
    node('A', 0, 0, 0, 0),
    node('C', 0, 1, 0, 76),
    node('B', 1, 0, 220, 0),
    node('D', 1, 1, 220, 76),
    dummy('d:A->E:1', 1, 2, 270, 128),
    node('E', 2, 0, 440, 0),
    node('F', 2, 1, 440, 76),
  ]
  const chains = [
    chain('A', 'B', ['A', 'B']),
    chain('C', 'D', ['C', 'D']),
    chain('A', 'E', ['A', 'd:A->E:1', 'E']),
    chain('D', 'E', ['D', 'E']),
    chain('B', 'F', ['B', 'F']),
  ]
  return placedOf(items, chains)
}

test('a straight forward edge is two points with no vertical segment', () => {
  const placed = placedOf([node('A', 0, 0, 0, 0), node('B', 1, 0, 220, 0)], [chain('A', 'B', ['A', 'B'])])
  const [r] = route(placed, cfg, measure).routes
  assert.equal(r.pts.length, 2)
  assert.deepEqual(r.pts, [{ x: 100, y: 20 }, { x: 220, y: 20 }])
  assert.equal(verticals(r.pts).length, 0)
})

test('a jog gets exactly one vertical strictly inside its gutter, on its own track', () => {
  const placed = placedOf(
    [node('A', 0, 0, 0, 0), node('B', 1, 0, 220, 0), node('C', 1, 1, 220, 76)],
    [chain('A', 'B', ['A', 'B']), chain('A', 'C', ['A', 'C'])],
  )
  const [ab, ac] = route(placed, cfg, measure).routes
  const vs = [verticals(ab.pts), verticals(ac.pts)]
  for (const v of vs) {
    assert.equal(v.length, 1)
    assert.ok(v[0].x > 100 && v[0].x < 220, `track ${v[0].x} must sit inside gutter (100,220)`)
  }
  assert.notEqual(vs[0][0].x, vs[1][0].x)
})

test('a 3-rank chain is one polyline straight through the dummy centre', () => {
  const d = dummy('d:A->B:1', 1, 1, 270, 128)
  const placed = placedOf([node('A', 0, 0, 0, 0), d, node('B', 2, 0, 440, 0)], [chain('A', 'B', ['A', d.id, 'B'])])
  const [r] = route(placed, cfg, measure).routes
  const cy = d.y + d.h / 2
  const atDummy = r.pts.filter((p) => Math.abs(p.x - d.x) < 0.5)
  assert.equal(atDummy.length, 1, 'the dummy is one point on the wire, not a corner')
  assert.equal(atDummy[0].y, cy)
  assert.equal(verticals(r.pts).filter((v) => Math.abs(v.x - d.x) < 0.5).length, 0)
  for (let i = 1; i < r.pts.length; i += 1) {
    const dx = Math.abs(r.pts[i].x - r.pts[i - 1].x)
    const dy = Math.abs(r.pts[i].y - r.pts[i - 1].y)
    assert.ok(dx < 0.5 || dy < 0.5, `segment ${i} is not orthogonal`)
  }
  const idx = r.pts.indexOf(atDummy[0])
  assert.equal(r.pts[idx - 1].y, cy)
  assert.equal(r.pts[idx + 1].y, cy)
})

test('no two of five routes over three ranks share a collinear segment', () => {
  const routed = route(spread(), cfg, measure)
  assert.equal(routed.routes.length, 5)
  assert.equal(sharedSegments(routed.routes), 0)
})

test('a backward edge leaves through the corridor and grows the drawing height', () => {
  const placed = placedOf(
    [node('A', 0, 0, 0, 0), node('B', 2, 0, 440, 0)],
    [chain('B', 'A', ['B', 'A'], undefined, true)],
  )
  const routed = route(placed, cfg, measure)
  const [r] = routed.routes
  assert.ok(r.pts.some((p) => p.y > placed.size.h), 'the wire must dip below the drawing')
  assert.ok(routed.size.h > placed.size.h)
  assert.ok(routed.size.h >= Math.max(...r.pts.map((p) => p.y)) + cfg.lane - 0.1)
  assert.deepEqual(r.pts[0], { x: 490, y: 40 })
  assert.deepEqual(r.pts[r.pts.length - 1], { x: 50, y: 40 })
})

test('a backward wire never cuts through a node stacked under its own ends', () => {
  const placed = placedOf(
    [
      node('A', 0, 0, 0, 0),
      node('C', 0, 1, 0, 100),
      node('G', 1, 0, 220, 50),
      node('B', 2, 0, 440, 0),
      node('F', 2, 1, 440, 100),
    ],
    [chain('B', 'A', ['B', 'A'], undefined, true)],
  )
  const [r] = route(placed, cfg, measure).routes
  const inside = (p: Point, b: Box): boolean =>
    p.x > b.x + 0.5 && p.x < b.x + b.w - 0.5 && p.y > b.y + 0.5 && p.y < b.y + b.h - 0.5
  for (let i = 1; i < r.pts.length; i += 1) {
    const a = r.pts[i - 1]
    const b = r.pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2))
    for (let k = 0; k <= n; k += 1) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }
      for (const [id, box] of placed.boxes) assert.ok(!inside(p, box), `${r.key} cuts through ${id} at ${JSON.stringify(p)}`)
    }
  }
})

test('every labelled chain gets a chip clear of nodes and of every other chip', () => {
  const base = spread()
  const placed: Placed = {
    ...base,
    chains: base.chains.map((c) => ({ ...c, label: c.key.toLowerCase() })),
  }
  const routed = route(placed, cfg, measure)
  const chips = routed.routes.flatMap((r) => (r.label ? [{ key: r.key, box: r.label.box }] : []))
  assert.equal(chips.length, 5, 'a label is never dropped')
  const area = (a: Box, b: Box): number => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    return w > 0 && h > 0 ? w * h : 0
  }
  for (const chip of chips) {
    assert.ok(chip.box.w > 0 && chip.box.h > 0)
    for (const box of placed.boxes.values()) assert.equal(area(chip.box, box), 0, `${chip.key} chip hits a node`)
    for (const other of chips) if (other.key !== chip.key) assert.equal(area(chip.box, other.box), 0)
  }
})

test('two calls are deep-equal', () => {
  const placed = spread()
  assert.deepEqual(route(placed, cfg, measure), route(placed, cfg, measure))
})

test('route never mutates the Placed input', () => {
  const placed = spread()
  const snapshot = structuredClone(placed)
  route(placed, cfg, measure)
  assert.deepEqual(placed, snapshot)
})


test('an export route names its file in the path: svg, png, html and every layer', () => {
  assert.deepEqual(routeOf('/d/shop.svg'), { kind: 'export', format: 'svg', id: 'shop' })
  assert.deepEqual(routeOf('/d/shop.png'), { kind: 'export', format: 'png', id: 'shop' })
  assert.deepEqual(routeOf('/d/shop.html'), { kind: 'export', format: 'html', id: 'shop' })
  assert.deepEqual(routeOf('/d/shop.layers'), { kind: 'export', format: 'layers', id: 'shop' })
  assert.equal(routeOf('/d/shop.zip'), null, 'an unknown extension is not an export')
})

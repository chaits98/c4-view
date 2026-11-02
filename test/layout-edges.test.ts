/**
 * The degenerate shapes the routing and ordering code guards against: a chain that names an item
 * that is not there, a chip wider than the run it wants to sit on, a wire with nothing below it.
 * These are not hypothetical — a hand-written model produces all of them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT, type Box, type Chain, type Placed, type PlacedItem, type Point, type Route } from '../src/types.ts'
import { measure } from '../src/metrics.ts'
import { buildPorts, portX, portY } from '../src/layout/ports.ts'
import { placeLabels } from '../src/layout/labels.ts'
import { countCrossings, order } from '../src/layout/order.ts'
import { blocked, exitY } from '../src/layout/backward.ts'

const cfg = DEFAULT_LAYOUT

const item = (id: string, rank: number, x: number, y: number, w = 100, h = 40, dummy = false): PlacedItem =>
  ({ id, rank, index: 0, x, y, w, h, dummy })

const placedOf = (items: PlacedItem[]): Placed => {
  const boxes = new Map<string, Box>(items.map((it) => [it.id, { x: it.x, y: it.y, w: it.w, h: it.h }]))
  const chains = [] as Chain[]
  const size = { w: 0, h: 0 }
  return { boxes, items: new Map(items.map((it) => [it.id, it])), chains, groups: [], size }
}

const chain = (from: string, to: string, items: string[], backward = false): Chain =>
  ({ key: `${from}->${to}`, from, to, items, style: 'flow', backward })

test('a chain naming an item nobody placed is skipped, not turned into NaN ports', () => {
  const placed = placedOf([item('a', 0, 0, 0), item('b', 1, 200, 0)])
  const ports = buildPorts([chain('a', 'ghost', ['a', 'ghost']), chain('a', 'b', ['a', 'b'])], placed.items)
  assert.ok(ports.size > 0, 'the valid chain still gets ports')
  assert.equal([...ports.values()].every((v) => Number.isFinite(v)), true)
})

test('a backward chain leaves from the bottom of both ends', () => {
  const placed = placedOf([item('a', 0, 0, 0), item('c', 2, 400, 0)])
  const back = chain('c', 'a', ['c', 'a'], true)
  const ports = buildPorts([back], placed.items)
  const x1 = portX(placed.items.get('c') as PlacedItem, back.key, ports)
  const x2 = portX(placed.items.get('a') as PlacedItem, back.key, ports)
  assert.ok(x1 > 400 && x1 < 500, 'a port inside the box, not on its centre line')
  assert.ok(x2 > 0 && x2 < 100)
})

test('a dummy has no port: it leaves from its own centre', () => {
  const dummy = item('d:1', 1, 200, 0, 0, 30, true)
  assert.equal(portY(dummy, 'l', 'k', new Map()), dummy.y + dummy.h / 2)
  assert.equal(portX(dummy, 'k', new Map()), dummy.x)
  const real = item('a', 0, 0, 0)
  assert.equal(portY(real, 'l', 'missing', new Map()), real.y + real.h / 2, 'no port recorded: the centre')
})

test('a label chip wider than every run is still placed, overhanging the run', () => {
  const placed = placedOf([item('a', 0, 0, 0), item('b', 1, 400, 0)])
  const long = 'REST /v1/orders/{id}/lines?expand=all — idempotent'
  const routes: Route[] = [
    { key: 'a->b', pts: [{ x: 100, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 0 }, { x: 400, y: 0 }], label: { text: long, box: { x: 0, y: 0, w: 0, h: 0 } } },
  ]
  const [out] = placeLabels(routes, placed, cfg, measure)
  const box = out.label?.box
  assert.ok(box && box.w > 0, 'a chip exists')
  assert.ok(box.w > 200, 'and it is wider than the 100px run it had to fit')
})

test('a route with no label keeps its points and gets no chip', () => {
  const placed = placedOf([item('a', 0, 0, 0)])
  const routes: Route[] = [{ key: 'a->a', pts: [{ x: 0, y: 0 }, { x: 0, y: 40 }] }]
  const [out] = placeLabels(routes, placed, cfg, measure)
  assert.equal(out.label, undefined)
  assert.deepEqual(out.pts, routes[0].pts)
})

test('a route whose points have no horizontal run still gets a chip', () => {
  const placed = placedOf([item('a', 0, 0, 0)])
  const routes: Route[] = [{ key: 'a->b', pts: [{ x: 50, y: 0 }, { x: 50, y: 40 }], label: { text: 'dep', box: { x: 0, y: 0, w: 0, h: 0 } } }]
  const [out] = placeLabels(routes, placed, cfg, measure)
  assert.ok(out.label, 'a vertical-only route still carries its label')
  assert.equal(out.label?.box.h, 18)
})

test('ordering ignores a chain that points at an item nobody ranked', () => {
  const items = new Map<string, PlacedItem>([
    ['a', { ...item('a', 0, 0, 0), index: 0 }],
    ['b', { ...item('b', 1, 200, 0), index: 0 }],
  ])
  const ranked = { ranks: [['a'], ['b']], items, chains: [chain('a', 'ghost', ['a', 'ghost']), chain('a', 'b', ['a', 'b'])] }
  assert.equal(countCrossings(ranked), 0, 'one straight wire, no crossing')
  assert.deepEqual(order(ranked, cfg).ranks, [['a'], ['b']])
})

test('a backward pair is ordered by its lower end', () => {
  const items = new Map<string, PlacedItem>([
    ['a', { ...item('a', 0, 0, 0), index: 0 }],
    ['c', { ...item('c', 2, 400, 0), index: 0 }],
  ])
  const ranked = { ranks: [['a'], [], ['c']], items, chains: [chain('c', 'a', ['c', 'a'], true)] }
  assert.equal(countCrossings(ranked), 0, 'a backward wire is not counted as a downward crossing')
})

test('a wire is only blocked by a node it actually passes through', () => {
  const placed = placedOf([item('a', 0, 0, 0), item('b', 1, 200, 200)])
  assert.equal(blocked(placed, 250, 150, 300, new Set()), true, 'x=250 crosses b between y=150 and 300')
  assert.equal(blocked(placed, 250, 150, 300, new Set(['b'])), false, 'unless that node is the one being skipped')
  assert.equal(blocked(placed, 900, 150, 300, new Set()), false, 'a track that touches nothing')
  assert.equal(blocked(placed, 250, 40, 45, new Set()), false, 'a run that stops above the node is clear')
})

test('a wire with nothing below it leaves from the bottom edge', () => {
  const placed = placedOf([item('a', 0, 0, 0)])
  assert.equal(exitY(placed, placed.items.get('a') as PlacedItem), 40, 'no neighbour below: the bottom edge')
  const stacked = placedOf([item('a', 0, 0, 0), item('c', 1, 0, 120)])
  assert.equal(exitY(stacked, stacked.items.get('a') as PlacedItem), 80, 'halfway into the gap below')
})

test('a point is a legal route input, even with no run to sit on', () => {
  const pts: Point[] = [{ x: 0, y: 0 }]
  const placed = placedOf([item('a', 0, 0, 0)])
  const routes: Route[] = [{ key: 'k', pts, label: { text: 'x', box: { x: 0, y: 0, w: 0, h: 0 } } }]
  const [out] = placeLabels(routes, placed, cfg, measure)
  assert.ok(out.label?.box.w && out.label.box.w > 0)
})


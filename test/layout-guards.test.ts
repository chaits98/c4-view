/**
 * The layout functions are pure and typed, but their inputs are built stage by stage — and a stage
 * can hand the next one a slightly different picture (a rank with an id the item map does not have,
 * a chain whose ends were dropped). These are the guards for that: they must degrade, never produce
 * NaN, Infinity or a throw, because one bad number poisons every box downstream.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT, type Box, type Chain, type Placed, type PlacedItem, type Ranked, type RankItem } from '../src/types.ts'
import { measure } from '../src/metrics.ts'
import { place } from '../src/layout/place.ts'
import { rank } from '../src/layout/rank.ts'
import { countCrossings, order } from '../src/layout/order.ts'
import { buildPorts } from '../src/layout/ports.ts'
import { placeLabels } from '../src/layout/labels.ts'

const cfg = DEFAULT_LAYOUT

const finite = (n: number): boolean => Number.isFinite(n)

/** Every number a drawing carries, so one guard failure shows up as a single assertion. */
const numbersOf = (p: Placed): number[] => [
  ...[...p.boxes.values()].flatMap((b: Box) => [b.x, b.y, b.w, b.h]),
  ...[...p.items.values()].flatMap((it: PlacedItem) => [it.x, it.y, it.w, it.h]),
  ...p.groups.flatMap((g) => [g.box.x, g.box.y, g.box.w, g.box.h]),
  p.size.w,
  p.size.h,
]

const itemMap = (items: Array<Partial<PlacedItem> & { id: string }>): Map<string, RankItem> =>
  new Map(items.map((it, i) => [it.id, { id: it.id, rank: it.rank ?? 0, index: i, w: it.w ?? 100, h: it.h ?? 40, dummy: it.dummy ?? false }]))

const chainOf = (items: string[], key = 'a->b'): Chain => ({ key, from: items[0] ?? 'a', to: items.at(-1) ?? 'b', items, style: 'flow', backward: false })

test('place survives a rank naming an id the item map does not have', () => {
  const ranked: Ranked = { ranks: [['a'], ['ghost', 'b']], items: itemMap([{ id: 'a' }, { id: 'b' }]), chains: [chainOf(['a', 'b'])] }
  const p = place(ranked, { path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }, { id: 'b', label: 'B', subtype: 'system', state: 'built' as const }], edges: [] }, cfg, measure)
  assert.ok(numbersOf(p).every(finite), 'every coordinate is a real number')
  assert.ok(p.boxes.has('b'), 'the real node still placed')
})

test('place survives a chain whose ends are not in the item map', () => {
  const ranked: Ranked = { ranks: [['a']], items: itemMap([{ id: 'a' }]), chains: [chainOf(['gone', 'missing'], 'gone->missing')] }
  const p = place(ranked, { path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }], edges: [] }, cfg, measure)
  assert.ok(numbersOf(p).every(finite))
})

test('place survives an empty level', () => {
  const p = place({ ranks: [], items: new Map(), chains: [] }, { path: '', nodes: [], edges: [] }, cfg, measure)
  assert.equal(p.size.h, 0, 'nothing to draw is a zero-height drawing, not a crash')
})

test('ranking an id that appears in no edge still lands in column 0', () => {
  const r = rank({ path: '', nodes: [{ id: 'lonely', label: 'Lonely', subtype: 'system', state: 'built' as const }], edges: [] }, cfg)
  assert.deepEqual(r.ranks, [['lonely']])
  assert.equal(r.items.get('lonely')?.rank, 0)
})

test('ordering tolerates a chain whose items are not ranked', () => {
  const ranked: Ranked = { ranks: [['a'], ['b']], items: itemMap([{ id: 'a' }, { id: 'b' }]), chains: [chainOf(['a', 'nowhere', 'b'])] }
  assert.equal(countCrossings(ranked), 0, 'a gap in a chain is not a crossing')
  assert.doesNotThrow(() => order(ranked, cfg))
})

test('ports tolerate a chain with a single item', () => {
  const items = new Map<string, PlacedItem>([['a', { id: 'a', rank: 0, index: 0, w: 100, h: 40, dummy: false, x: 0, y: 0 }]])
  const ports = buildPorts([chainOf(['a'], 'a->a')], items)
  assert.ok([...ports.values()].every(finite), 'no NaN port from a chain that touches one side twice')
})

test('labels tolerate a route with no points at all', () => {
  const placed: Placed = { items: new Map(), boxes: new Map(), chains: [], groups: [], size: { w: 0, h: 0 } }
  const [out] = placeLabels([{ key: 'k', pts: [], label: { text: 'x', box: { x: 0, y: 0, w: 0, h: 0 } } }], placed, cfg, measure)
  assert.ok(out.label?.box && finite(out.label.box.x), 'a chip exists even with nothing to sit on')
})

test('two labels never share a box, even when the first one is huge', () => {
  const placed: Placed = {
    items: new Map(),
    boxes: new Map([['n', { x: 100, y: 0, w: 200, h: 40 }]]),
    chains: [],
    groups: [],
    size: { w: 400, h: 40 },
  }
  const pts = [{ x: 0, y: 20 }, { x: 400, y: 20 }]
  const routes = [
    { key: 'a->b', pts, label: { text: 'a very wide label that will want the whole run', box: { x: 0, y: 0, w: 0, h: 0 } } },
    { key: 'b->c', pts, label: { text: 'short', box: { x: 0, y: 0, w: 0, h: 0 } } },
  ]
  const out = placeLabels(routes, placed, cfg, measure)
  const [first, second] = out.map((r) => r.label?.box)
  assert.ok(first && second)
  const overlaps = first.x < second.x + second.w && second.x < first.x + first.w && first.y < second.y + second.h && second.y < first.y + first.h
  assert.equal(overlaps, false, 'the second chip moved rather than stacking on the first')
})

/**
 * Rank + order: columns come from the graph, the order inside a column comes
 * from the wires. Every case here is a literal fixture — no files, no clock.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rank } from '../src/layout/rank.ts'
import { countCrossings, order } from '../src/layout/order.ts'
import { DEFAULT_LAYOUT, type EdgeSpec, type LevelSpec, type NodeSpec } from '../src/types.ts'

const cfg = DEFAULT_LAYOUT

const node = (id: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({
  id,
  label: id.toUpperCase(),
  subtype: 'system',
  ...extra,
})

const lvl = (nodes: NodeSpec[], edges: Array<[string, string]>): LevelSpec => ({
  path: '',
  nodes,
  edges: edges.map(([from, to]): EdgeSpec => ({ from, to })),
})

test('a chain gives one column per hop', () => {
  const r = rank(lvl([node('a'), node('b'), node('c')], [['a', 'b'], ['b', 'c']]), cfg)
  assert.deepEqual(r.ranks, [['a'], ['b'], ['c']])
})

test('a span-2 edge gets a dummy in the column it crosses', () => {
  const r = rank(lvl([node('a'), node('c', { rank: 2 })], [['a', 'c']]), cfg)
  assert.deepEqual(r.ranks, [['a'], ['d:a->c:1'], ['c']])
  assert.deepEqual(r.chains[0].items, ['a', 'd:a->c:1', 'c'])
  assert.equal(r.chains[0].backward, false)
  const dummy = r.items.get('d:a->c:1')
  assert.ok(dummy)
  assert.equal(dummy.dummy, true)
  assert.equal(dummy.w, 0)
  assert.equal(dummy.h, 19.2)
})

test('a cycle marks exactly one chain backward and still ranks both nodes', () => {
  const r = rank(lvl([node('a'), node('b')], [['a', 'b'], ['b', 'a']]), cfg)
  const back = r.chains.filter((c) => c.backward)
  assert.equal(back.length, 1)
  assert.equal(back[0].key, 'b->a')
  assert.deepEqual(r.ranks.map((row) => row.length), [1, 1])
  assert.deepEqual([...new Set(r.ranks.flat())].sort(), ['a', 'b'])
})

test('a rank hint wins over the computed depth', () => {
  const r = rank(lvl([node('a'), node('b', { rank: 3 })], [['a', 'b']]), cfg)
  assert.equal(r.items.get('b')?.rank, 3) // computed depth would be 1
  assert.deepEqual(r.ranks, [['a'], ['d:a->b:1'], ['d:a->b:2'], ['b']])
  assert.equal(r.chains[0].backward, false)
})

test('an unhinted gap stays empty', () => {
  const r = rank(lvl([node('a'), node('b', { rank: 3 })], []), cfg)
  assert.deepEqual(r.ranks, [['a'], [], [], ['b']])
})

test('order() never increases crossings on a diamond', () => {
  const r = rank(
    lvl([node('a'), node('b'), node('c'), node('d')], [['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd']]),
    cfg,
  )
  const before = countCrossings(r)
  assert.equal(before, 1)
  assert.ok(countCrossings(order(r, cfg)) <= before)
})

test('order() straightens a crossed pair', () => {
  const r = rank(lvl([node('a'), node('b'), node('c'), node('d')], [['a', 'd'], ['b', 'c']]), cfg)
  assert.equal(countCrossings(r), 1)
  const o = order(r, cfg)
  assert.equal(countCrossings(o), 0)
  assert.deepEqual(o.ranks, [['a', 'b'], ['d', 'c']])
})

test('two identical calls are deep-equal', () => {
  const level = lvl([node('a'), node('b'), node('c'), node('d')], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']])
  assert.deepEqual(rank(level, cfg), rank(level, cfg))
  assert.deepEqual(order(rank(level, cfg), cfg), order(rank(level, cfg), cfg))
})

test('order() does not mutate its input', () => {
  const r = rank(lvl([node('a'), node('b'), node('c'), node('d')], [['a', 'd'], ['b', 'c']]), cfg)
  const snapshot = structuredClone(r)
  order(r, cfg)
  assert.deepEqual(r, snapshot)
})

test('rank() does not mutate the level', () => {
  const level = lvl([node('a'), node('b'), node('c', { rank: 2 })], [['a', 'b'], ['b', 'c'], ['c', 'a']])
  const snapshot = structuredClone(level)
  rank(level, cfg)
  assert.deepEqual(level, snapshot)
})

test('a level with no nodes ranks to nothing, not to a crash', () => {
  assert.deepEqual(rank(lvl([], []), cfg), { ranks: [], items: new Map(), chains: [] })
})

test('a repeated edge is one edge, and its label rides the chain', () => {
  const level: LevelSpec = {
    path: '',
    nodes: [node('a'), node('b')],
    edges: [
      { from: 'a', to: 'b', label: 'writes' },
      { from: 'a', to: 'b', label: 'ignored: duplicate' },
    ],
  }
  const r = rank(level, cfg)
  assert.equal(r.chains.length, 1, 'one wire, not two')
  assert.equal(r.chains[0].label, 'writes', 'the first occurrence wins')
})

test('a rank hint is absolute, and the whole drawing shifts back to column 0', () => {
  // b pinned to 2: the longest-path pass must not pull it to 1, and the wire crosses a dummy there
  const pinned = rank(lvl([node('a'), node('b', { rank: 2 })], [['a', 'b']]), cfg)
  assert.equal(pinned.items.get('b')?.rank, 2, 'the pin wins over rank derivation')
  assert.equal(pinned.items.get('a')?.rank, 0)
  assert.equal(pinned.ranks.length, 3, 'the empty column keeps a slot for the dummy')

  // every node pinned above zero: the drawing moves, the pins keep their relative distance
  const shifted = rank(lvl([node('a', { rank: 3 }), node('b', { rank: 4 })], [['a', 'b']]), cfg)
  assert.deepEqual([shifted.items.get('a')?.rank, shifted.items.get('b')?.rank], [0, 1])
})

test('a cycle becomes a backward chain instead of an infinite graph', () => {
  const r = rank(lvl([node('a'), node('b')], [['a', 'b'], ['b', 'a']]), cfg)
  const backward = r.chains.filter((c) => c.backward)
  assert.equal(backward.length, 1, 'exactly one edge is drawn backwards')
  assert.deepEqual(r.chains.filter((c) => !c.backward).map((c) => c.key), ['a->b'])
})

test('an edge that skips a column gets a dummy in it', () => {
  // a pinned at 0 and b pinned at 2 leaves column 1 empty, so the wire crosses a dummy there
  const r = rank(lvl([node('a', { rank: 0 }), node('b', { rank: 2 })], [['a', 'b']]), cfg)
  const dummies = r.ranks[1].filter((id) => id.startsWith('d:'))
  assert.equal(dummies.length, 1, 'one dummy on the empty column')
  assert.equal(r.items.get(dummies[0])?.dummy, true)
  assert.equal(r.items.get(dummies[0])?.rank, 1)
})

test('two wires leaving one node both survive', () => {
  const r = rank(lvl([node('a'), node('b'), node('c')], [['a', 'b'], ['a', 'c']]), cfg)
  assert.deepEqual(r.chains.map((c) => c.key), ['a->b', 'a->c'])
  assert.equal(r.ranks[1].length, 2, 'b and c share the column')
})

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

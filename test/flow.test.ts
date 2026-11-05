/**
 * The flow order is the narration: every edge, once, in the order a person would
 * explain the system. One animating edge at a time depends on it being linear.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowIndex, flowOrder } from '../src/flow.ts'
import { parseModel } from '../src/model.ts'
import type { LevelSpec } from '../src/types.ts'

const level = (over: Partial<LevelSpec> = {}): LevelSpec => ({
  path: '',
  nodes: [
    { id: 'a', label: 'A', subtype: 'system', state: 'built' as const },
    { id: 'b', label: 'B', subtype: 'database', state: 'built' as const },
    { id: 'c', label: 'C', subtype: 'system', state: 'built' as const },
  ],
  edges: [
    { desc: 'the payload this edge carries', from: 'a', to: 'b', style: 'flow' },
    { desc: 'the payload this edge carries', from: 'b', to: 'c', style: 'flow' },
    { desc: 'the payload this edge carries', from: 'a', to: 'c', style: 'dep' },
  ],
  ...over,
})

test('a declared flow wins and keeps its order', () => {
  const declared = level({ flow: ['b->c', 'a->b', 'a->c'] })
  assert.deepEqual(flowOrder(declared), ['b->c', 'a->b', 'a->c'])
})

test('a declared flow that misses an edge gets the rest appended, not dropped', () => {
  assert.deepEqual(flowOrder(level({ flow: ['b->c'] })), ['b->c', 'a->b', 'a->c'])
})

test('without a flow the order walks chains depth-first from the sources', () => {
  // a has no incoming edge: a->b, then b->c, then the sibling a->c
  assert.deepEqual(flowOrder(level()), ['a->b', 'b->c', 'a->c'])
})

test('a cycle still yields every edge exactly once', () => {
  const cyclic = level({
    nodes: [
      { id: 'a', label: 'A', subtype: 'system', state: 'built' as const },
      { id: 'b', label: 'B', subtype: 'system', state: 'built' as const },
    ],
    edges: [
      { desc: 'the payload this edge carries', from: 'a', to: 'b', style: 'flow' },
      { desc: 'the payload this edge carries', from: 'b', to: 'a', style: 'flow' },
    ],
  })
  assert.deepEqual(flowOrder(cyclic), ['a->b', 'b->a'])
})

test('flow order is unique, total and 1-based in flowIndex', () => {
  const order = flowOrder(level())
  assert.equal(new Set(order).size, order.length)
  assert.equal(order.length, level().edges.length)
  const index = flowIndex(level())
  assert.deepEqual([...index.values()].sort((x, y) => x - y), [1, 2, 3])
  assert.equal(index.get(order[0]), 1)
})

test('the model validator rejects a flow key that is not an edge', () => {
  assert.throws(
    () =>
      parseModel({
        id: 'd',
        title: 'D',
        levels: [
          {
            path: '',
            nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }, { id: 'b', label: 'B', subtype: 'system', state: 'built' as const }],
            edges: [{ desc: 'the payload this edge carries', from: 'a', to: 'b' }],
            flow: ['a->b', 'b->ghost'],
          },
        ],
      }),
    /flow\[1\]: "b->ghost" is not an edge of this level/,
  )
})

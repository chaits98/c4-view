/**
 * Expansion: the parent ring keeps its boxes and edges, the host becomes a dashed frame, and the
 * child's interior fills it. This is the picture the owner drew by hand — one context diagram, then
 * "Context 1" opened with a,b,c,d inside while User / Context 2 / Context 3 stay outside.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseModel } from '../src/model.ts'
import { expandLevel } from '../src/expand.ts'
import { renderExpanded } from '../src/render.ts'
import type { Model } from '../src/types.ts'

const model = (): Model =>
  parseModel(JSON.parse(readFileSync(new URL('../examples/lens.json', import.meta.url), 'utf8')) as unknown)

test('the host disappears and its interior takes its place, prefixed', () => {
  const { level, frameId, frameLabel } = expandLevel(model(), 'context1')
  const ids = level.nodes.map((n) => n.id)
  assert.ok(!ids.includes('context1'), 'the host box is gone: it is the frame now')
  for (const inner of ['a', 'b', 'c', 'd']) assert.ok(ids.includes(`context1/${inner}`), `missing context1/${inner}`)
  const frame = level.groups?.find((g) => g.id === frameId)
  assert.ok(frame, 'a frame group exists')
  assert.equal(frameLabel, 'Context 1')
  assert.deepEqual([...(frame?.members ?? [])].sort(), ['context1/a', 'context1/b', 'context1/c', 'context1/d'])
})

test('the outside world survives: neighbours stay, and every crossing edge re-attaches through its port', () => {
  const { level } = expandLevel(model(), 'context1')
  const ids = new Set(level.nodes.map((n) => n.id))
  for (const outside of ['user', 'context2', 'context3']) assert.ok(ids.has(outside), `${outside} must stay`)
  const key = (from: string, to: string) => level.edges.some((e) => e.from === from && e.to === to)
  assert.ok(key('user', 'context1/a'), 'user -> a: the incoming edge lands on the port, not on a missing box')
  assert.ok(key('context1/d', 'context2'), 'd -> context2: the outgoing edge leaves from the port')
  assert.ok(key('context1/c', 'context3'), 'c -> context3')
  assert.ok(key('context1/a', 'context1/b'))
  assert.ok(key('context1/b', 'context1/d'))
  assert.ok(key('context1/b', 'context1/c'))
  assert.equal(level.edges.length, 6, 'nothing invented, nothing dropped')
})

test('the narration walks one packet: in, through the interior, then out', () => {
  const { level } = expandLevel(model(), 'context1')
  assert.deepEqual(level.flow, [
    'user->context1/a',
    'context1/a->context1/b',
    'context1/b->context1/d',
    'context1/b->context1/c',
    'context1/d->context2',
    'context1/c->context3',
  ])
  assert.equal(new Set(level.flow).size, level.flow?.length, 'every composed edge appears exactly once')
})

test('the expanded level passes every geometry gate, and renders byte-identically twice', () => {
  const first = renderExpanded(model(), 'context1')
  const second = renderExpanded(model(), 'context1')
  assert.equal(first.levels[0].audit.ok, true, JSON.stringify(first.levels[0].audit))
  assert.equal(first.levels[0].audit.groupNode, 0, 'the frame must not swallow a stranger')
  assert.equal(first.levels[0].svg, second.levels[0].svg, 'same model, same bytes')
})

test('a node inside the frame still knows where its own drill goes', () => {
  const deep: Model = parseModel({
    id: 'deep',
    title: 'deep',
    levels: [
      { path: '', nodes: [{ id: 'box', label: 'Box', subtype: 'system' }], edges: [] },
      {
        path: 'box',
        ports: {},
        nodes: [
          { id: 'one', label: 'One', subtype: 'service-logic' },
          { id: 'two', label: 'Two', subtype: 'service-logic' },
        ],
        edges: [{ from: 'one', to: 'two', label: 'calls' }],
      },
      {
        path: 'box/one',
        ports: { 'one->two': 'inner' },
        nodes: [{ id: 'inner', label: 'Inner', subtype: 'function' }],
        edges: [],
      },
    ],
  })
  const svg = renderExpanded(deep, 'box').levels[0].svg
  assert.match(svg, /data-drill="box\/one"/, 'the interior node that has its own level stays drillable')
})

test('expanding something that is not a lens fails with a named reason', () => {
  const m = model()
  assert.throws(() => expandLevel(m, 'nope'), /no level "nope"/)
  const noPorts = model()
  delete noPorts.levels[1].ports
  assert.throws(() => expandLevel(noPorts, 'context1'), /declares no ports/)
  // …but a box nothing connects to needs no ports at all
  const isolated = parseModel({
    id: 'solo',
    title: 'solo',
    levels: [
      { path: '', nodes: [{ id: 'box', label: 'Box', subtype: 'system' }], edges: [] },
      { path: 'box', nodes: [{ id: 'part', label: 'Part', subtype: 'function' }], edges: [] },
    ],
  })
  assert.equal(expandLevel(isolated, 'box').level.nodes.length, 1)
})

test('a port that points at a missing interior node is caught before layout', () => {
  const m = model()
  m.levels[1].ports = { ...m.levels[1].ports, 'user->context1': 'ghost' }
  assert.throws(() => expandLevel(m, 'context1'), /not in the level/)
})

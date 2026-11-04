/**
 * The audit must be able to FAIL. Every gate gets a planted defect, because a
 * grader that only ever prints zeroes proves nothing about the drawing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { densityOf, audit, auditLine, isDense, overlapArea } from '../src/audit.ts'
import { parseModel } from '../src/model.ts'
import { renderModel } from '../src/render.ts'
import type { Box, LevelSpec, Placed, Route, Routed } from '../src/types.ts'

const level = (nodes: number, edges = 0): LevelSpec => ({
  path: '',
  nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, label: `N${i}`, subtype: 'system' as const })),
  edges: Array.from({ length: edges }, (_, i) => ({ desc: 'the payload this edge carries', from: `n${i % nodes}`, to: `n${(i + 1) % nodes}`, style: 'flow' as const })),
})

const placed = (boxes: Record<string, Box>): Placed => ({
  items: new Map(Object.entries(boxes).map(([id, b]) => [id, { id, rank: 0, index: 0, w: b.w, h: b.h, dummy: false, x: b.x, y: b.y }])),
  chains: [],
  boxes: new Map(Object.entries(boxes)),
  groups: [],
  size: { w: 900, h: 600 },
})

const routed = (routes: Array<{ key: string; pts: [number, number][]; label?: Box }>, size = { w: 900, h: 600 }): Routed => ({
  routes: routes.map((r) => ({
    key: r.key,
    pts: r.pts.map(([x, y]) => ({ x, y })),
    ...(r.label ? { label: { text: 'x', box: r.label } } : {}),
  })) as Route[],
  size,
})

test('clean geometry passes every gate', () => {
  const report = audit(
    placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 200, y: 0, w: 100, h: 40 } }),
    routed([{ key: 'a->b', pts: [[100, 20], [200, 20]], label: { x: 130, y: 8, w: 30, h: 18 } }]),
    level(2, 1),
  )
  assert.equal(report.ok, true, auditLine(report))
})

test('node ∩ node is caught', () => {
  const report = audit(placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 90, y: 10, w: 100, h: 40 } }), routed([]), level(2))
  assert.equal(report.nodeNode, 1)
  assert.equal(report.ok, false)
})

test('a wire through a foreign node is caught', () => {
  const report = audit(
    placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 400, y: 0, w: 100, h: 40 }, c: { x: 200, y: 0, w: 100, h: 40 } }),
    routed([{ key: 'a->b', pts: [[100, 20], [400, 20]] }]),
    level(3, 1),
  )
  assert.equal(report.wireNode, 1, auditLine(report))
  assert.equal(report.ok, false)
})

test('a wire may touch its own end nodes', () => {
  const report = audit(
    placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 300, y: 0, w: 100, h: 40 } }),
    routed([{ key: 'a->b', pts: [[100, 20], [300, 20]] }]),
    level(2, 1),
  )
  assert.equal(report.wireNode, 0)
})

test('two routes sharing a segment are caught', () => {
  const report = audit(
    placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 400, y: 0, w: 100, h: 40 } }),
    routed([
      { key: 'a->b', pts: [[100, 60], [400, 60]] },
      { key: 'a->b2', pts: [[100, 60], [250, 60], [250, 120], [400, 120]] },
    ]),
    level(2, 2),
  )
  assert.equal(report.wireWire, 1, auditLine(report))
  assert.equal(report.ok, false)
})

test('perpendicular routes cross without counting as shared segments', () => {
  const report = audit(
    placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 400, y: 0, w: 100, h: 40 } }),
    routed([
      { key: 'a->b', pts: [[100, 60], [400, 60]] },
      { key: 'c->d', pts: [[250, 0], [250, 200]] },
    ]),
    level(2, 2),
  )
  assert.equal(report.wireWire, 0)
  assert.equal(report.crossings, 1)
  assert.equal(report.ok, true)
})

test('chips covering each other or a node are caught', () => {
  const report = audit(
    placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 400, y: 0, w: 100, h: 40 } }),
    routed([
      { key: 'a->b', pts: [[100, 60], [400, 60]], label: { x: 200, y: 50, w: 60, h: 18 } },
      { key: 'a->b2', pts: [[100, 120], [400, 120]], label: { x: 210, y: 55, w: 60, h: 18 } },
      { key: 'a->b3', pts: [[100, 180], [400, 180]], label: { x: 20, y: 10, w: 60, h: 18 } },
    ]),
    level(2, 3),
  )
  assert.equal(report.chipChip, 1, auditLine(report))
  assert.equal(report.chipNode, 1, auditLine(report))
  assert.equal(report.ok, false)
})

test('overlapArea ignores a shared edge and a nested box is fully counted', () => {
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 0)
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 4, h: 4 }), 16)
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 4, h: 4 }), 0)
})

test('auditLine names every gate', () => {
  const line = auditLine(audit(placed({ a: { x: 0, y: 0, w: 10, h: 10 } }), routed([]), level(1)))
  for (const token of ['node∧node', 'wire∧node', 'wire∧wire', 'chip∧chip', 'chip∧node', 'crossings', 'aspect']) {
    assert.ok(line.includes(token), `missing ${token} in: ${line}`)
  }
})

test('a wire running through its OWN source beyond the port is caught', () => {
  // the old rule exempted a route's whole end node, so a 100px loop-back inside its own
  // source audited clean (found by an external verifier on a rank-hint model)
  const report = audit(
    placed({ a: { x: 0, y: 0, w: 200, h: 100 }, b: { x: 600, y: 0, w: 100, h: 40 } }),
    routed([{ key: 'a->b', pts: [[200, 50], [300, 50], [300, 90], [100, 90], [100, 50], [300, 50], [600, 50]] }]),
    level(2, 1),
  )
  assert.equal(report.wireNode, 1, auditLine(report))
  assert.equal(report.ok, false)
})

test('a boundary box over a non-member is a gate, not a note', () => {
  const spec: LevelSpec = {
    path: '',
    nodes: [
      { id: 'a', label: 'A', subtype: 'system' },
      { id: 'b', label: 'B', subtype: 'system' },
      { id: 'x', label: 'X', subtype: 'system' },
    ],
    edges: [{ desc: 'the payload this edge carries', from: 'a', to: 'b', style: 'flow' }],
    groups: [{ id: 'g', label: 'edge', members: ['a'] }],
  }
  const p = placed({ a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 300, y: 0, w: 100, h: 40 }, x: { x: 110, y: 60, w: 100, h: 40 } })
  p.groups = [{ id: 'g', label: 'edge', box: { x: -10, y: -10, w: 220, h: 80 } }]
  const report = audit(p, routed([{ key: 'a->b', pts: [[100, 20], [300, 20]] }]), spec)
  assert.equal(report.groupNode, 1, auditLine(report))
  assert.equal(report.ok, false)
})

test('a rank hint that sits level with its predecessor is reported as backward', () => {
  // b is hinted into a's column: a -> b is now drawn right-to-left, through a corridor.
  const model = parseModel({
    id: 'hinted',
    title: 'Hinted',
    levels: [
      {
        path: '',
        nodes: [
          { id: 'a', label: 'A', subtype: 'system' },
          { id: 'b', label: 'B', subtype: 'system', rank: 0 },
          { id: 'c', label: 'C', subtype: 'system' },
        ],
        edges: [{ desc: 'the payload this edge carries', from: 'a', to: 'b' }, { desc: 'the payload this edge carries', from: 'b', to: 'c' }],
      },
    ],
  })
  const report = renderModel(model).levels[0].audit
  assert.equal(report.backward, 1, `audit line: ${auditLine(report)}`)
})

test('a plain chain has no backward edges', () => {
  const model = parseModel({
    id: 'chain',
    title: 'Chain',
    levels: [
      {
        path: '',
        nodes: [
          { id: 'a', label: 'A', subtype: 'system' },
          { id: 'b', label: 'B', subtype: 'system' },
        ],
        edges: [{ desc: 'the payload this edge carries', from: 'a', to: 'b' }],
      },
    ],
  })
  assert.equal(renderModel(model).levels[0].audit.backward, 0)
})

test('the density budget is two crossings per edge, and it is a gate', () => {
  assert.equal(isDense(4, 2), false, 'exactly at the budget is still readable')
  assert.equal(isDense(5, 2), true, 'past it is not')
  assert.equal(isDense(3, 0), true, 'a level with no edges and three crossings is broken regardless')
  assert.equal(isDense(20, 12), false, 'fresh2 measured 13/12 and passed')
})

test('the verdict an author aims at: crisp, ok, dense, over — and an empty level is crisp', () => {
  assert.deepEqual(densityOf(0, 0), { perEdge: 0, verdict: 'crisp' })
  assert.deepEqual(densityOf(5, 10), { perEdge: 0.5, verdict: 'crisp' })
  assert.deepEqual(densityOf(6, 10), { perEdge: 0.6, verdict: 'ok' })
  assert.deepEqual(densityOf(10, 10), { perEdge: 1, verdict: 'ok' })
  assert.deepEqual(densityOf(11, 10), { perEdge: 1.1, verdict: 'dense' })
  assert.deepEqual(densityOf(21, 10), { perEdge: 2.1, verdict: 'over' }, 'past the gate, and it says so')
  assert.deepEqual(densityOf(4, 2), { perEdge: 2, verdict: 'dense' }, 'two edges get the floor of two crossings')
})

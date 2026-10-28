/**
 * The audit must be able to FAIL. Every gate gets a planted defect, because a
 * grader that only ever prints zeroes proves nothing about the drawing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audit, auditLine, overlapArea } from '../src/audit.ts'
import type { Box, LevelSpec, Placed, Route, Routed } from '../src/types.ts'

const level = (nodes: number, edges = 0): LevelSpec => ({
  path: '',
  nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, label: `N${i}`, subtype: 'system' as const })),
  edges: Array.from({ length: edges }, (_, i) => ({ from: `n${i % nodes}`, to: `n${(i + 1) % nodes}`, style: 'flow' as const })),
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

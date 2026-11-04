/**
 * The structural shapes a real diagram takes: a diamond, a cycle, a fan-out, two disconnected
 * islands, a pinned rank, a chain that skips a column, a level with only one node.
 *
 * Each is drawn end to end — layout, routing, SVG, audit, page — and the same invariants are
 * checked every time: every node lands somewhere, every coordinate is a real number, and the audit
 * agrees that nothing overlaps. A shape that breaks the layout usually breaks these, not a unit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModel } from '../src/model.ts'
import { renderModel } from '../src/render.ts'
import { indexPage } from '../src/index-page.ts'
import { viewerPage } from '../src/viewer-page.ts'

const node = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, label: id.toUpperCase(), subtype: 'system', ...extra })
const edge = (from: string, to: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ from, to, desc: 'the payload this edge carries', ...extra })

const shapes: Array<{ name: string; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; groups?: Array<Record<string, unknown>> }> = [
  { name: 'diamond', nodes: [node('a'), node('b'), node('c'), node('d')], edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')] },
  { name: 'cycle', nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')] },
  { name: 'fan-out', nodes: [node('hub'), node('l'), node('r'), node('t')], edges: [edge('hub', 'l'), edge('hub', 'r'), edge('hub', 't')] },
  { name: 'islands', nodes: [node('a'), node('b'), node('x'), node('y')], edges: [edge('a', 'b'), edge('x', 'y')] },
  { name: 'empty-ranks', nodes: [node('a', { rank: 0 }), node('z', { rank: 6 })], edges: [] },
  { name: 'pinned', nodes: [node('a', { rank: 0 }), node('b', { rank: 3 })], edges: [edge('a', 'b')] },
  { name: 'single', nodes: [node('solo')], edges: [] },
  { name: 'rank-gap', nodes: [node('a', { rank: 0 }), node('b', { rank: 5 })], edges: [edge('b', 'a')] },
  { name: 'parallels', nodes: [node('a'), node('b')], edges: [edge('a', 'b', { label: 'one' }), edge('a', 'b', { label: 'two', style: 'dep' })] },
  { name: 'grouped', nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c')], groups: [{ id: 'g', label: 'Group', members: ['a', 'b'] }] },
]

for (const shape of shapes) {
  test(`the ${shape.name} shape draws, routes and audits without a bad number`, () => {
    const model = parseModel({
      id: shape.name,
      title: shape.name,
      levels: [{ path: '', nodes: shape.nodes, edges: shape.edges, ...(shape.groups ? { groups: shape.groups } : {}) }],
    })
    const level = renderModel(model).levels[0]
    const numbers = [...level.svg.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
    assert.ok(numbers.every(Number.isFinite), 'every number in the svg is finite')
    assert.ok(!/NaN|Infinity/.test(level.svg), 'and none of them is spelled out')
    assert.ok(level.audit.ok, `audit: ${JSON.stringify(level.audit)}`)
    assert.equal(level.audit.nodes, shape.nodes.length, 'every node was drawn')

    const html = viewerPage(model, '')
    assert.ok(html.includes(`Containers (${shape.nodes.length})`), 'the text version lists them all')
    const card = indexPage([{ id: shape.name, title: shape.name, levels: [''], created: '2026-01-01T00:00:00Z', pinned: false, updated: '2026-11-01T00:00:00.000Z', svg: level.svg, ok: level.audit.ok, nodes: level.audit.nodes, flows: level.audit.edges, wide: false }])
    assert.ok(card.includes('audit clean'), 'and the card agrees')
  })
}

test('a gutter too narrow for one track per wire spreads them instead of overlapping', () => {
  // four wires crossing the same gutter in a cramped layout: the base tracks do not fit
  const nodes = [['a0', 'a1', 'a2', 'a3'].map((id) => ({ id, label: id, subtype: 'system' })), ['b0', 'b1', 'b2', 'b3'].map((id) => ({ id, label: id, subtype: 'system' }))].flat()
  const edges = ['a0->b3', 'a1->b2', 'a2->b1', 'a3->b0'].map((pair) => {
    const [from, to] = pair.split('->')
    return { from, to, desc: 'the payload this edge carries' }
  })
  const model = parseModel({ id: 'tight', title: 'Tight', layout: { rankGap: 60, lane: 4 }, levels: [{ path: '', nodes, edges }] })
  const level = renderModel(model).levels[0]
  assert.ok(level.audit.ok, `a cramped gutter still audits clean: ${JSON.stringify(level.audit)}`)
  assert.equal(level.audit.wireWire, 0, 'and no two wires share a segment')
})

test('dummies stack in a rank without colliding', () => {
  const nodes = [{ id: 'a', label: 'A', subtype: 'system', rank: 0 }, { id: 'b', label: 'B', subtype: 'system', rank: 0 }, { id: 'c', label: 'C', subtype: 'system', rank: 4 }]
  const edges = [{ from: 'a', to: 'c', desc: 'calls c' }, { from: 'b', to: 'c', desc: 'calls c' }]
  const level = renderModel(parseModel({ id: 'dummies', title: 'Dummies', levels: [{ path: '', nodes, edges }] })).levels[0]
  assert.ok(level.audit.ok, `dummies are placed, not stacked: ${JSON.stringify(level.audit)}`)
})

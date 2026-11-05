/**
 * Vertical layout: the same drawing read down the page. It is a transpose, so the audit numbers must not move.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT, type LevelSpec, type Model } from '../src/types.ts'
import { layoutLevel, renderLevel } from '../src/render.ts'
import { parseModel } from '../src/model.ts'

/** A straight chain: the shape that comes out widest. */
function chain(n: number): LevelSpec {
  return {
    path: 'chain',
    title: 'Chain',
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, subtype: 'service-logic', state: 'built' as const, tech: 'ts' })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ desc: 'the payload this edge carries', from: `n${i}`, to: `n${i + 1}`, label: `step${i}`, style: 'flow' })),
    flow: Array.from({ length: n - 1 }, (_, i) => `n${i}->n${i + 1}`),
  } as LevelSpec
}

test('a strip too wide to read is stood upright, and its numbers do not change', () => {
  const lv = chain(12)
  const lr = layoutLevel(lv, { ...DEFAULT_LAYOUT, direction: 'LR' })
  assert.ok(lr.routed.size.w / lr.routed.size.h > 5, 'the horizontal version really is a strip')
  const tb = layoutLevel(lv, { ...DEFAULT_LAYOUT, direction: 'TB' })
  assert.equal(tb.audit.crossings, lr.audit.crossings, 'a transpose cannot add crossings')
  assert.equal(tb.audit.nodeNode, lr.audit.nodeNode)
  assert.equal(tb.audit.wireNode, lr.audit.wireNode)
  assert.equal(tb.audit.wireWire, lr.audit.wireWire)
  // the upright picture is laid out with the axes declared, so its box sizes are its own — the two drawings
  // share their crossings, not their pixels
  assert.ok(tb.routed.size.h > lr.routed.size.h, 'the upright one runs down the page')
  assert.ok(tb.routed.size.w < lr.routed.size.w, 'and not across it')
  assert.ok(tb.routed.size.w / tb.routed.size.h < 1, 'and it reads down the page')
})

test('a drawing that already fits keeps the C4 convention: left to right', () => {
  const lv = chain(4)
  const auto = layoutLevel(lv, DEFAULT_LAYOUT) // 'auto', and this drawing is not a strip
  assert.ok(auto.routed.size.w > auto.routed.size.h, 'still landscape')
})

test('direction TB stands the picture up even when it would fit', () => {
  const upright = layoutLevel(chain(3), { ...DEFAULT_LAYOUT, direction: 'TB' })
  assert.ok(upright.routed.size.h > upright.routed.size.w)
})

test('the parser accepts TB and refuses anything else', () => {
  const base = { id: 'm', title: 'M', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }], edges: [] }] }
  assert.equal(parseModel({ ...base, layout: { direction: 'TB' } } as unknown as Model).layout?.direction, 'TB')
  assert.throws(() => parseModel({ ...base, layout: { direction: 'diagonal' } } as unknown as Model), /direction/)
})

test('an upright level still renders and still audits clean', () => {
  const model = parseModel({ id: 'v', title: 'V', levels: [chain(6)] } as unknown as Model)
  const drawn = renderLevel(model, model.levels[0])
  assert.equal(drawn.audit.ok, true)
  assert.match(drawn.svg, /<svg[^>]+height="[\d.]+"/)
})

test('the full view composes every level into one picture, and it audits clean', async () => {
  const { fullView } = await import('../src/expand-all.ts')
  const { renderLevel } = await import('../src/render.ts')
  const model = parseModel({
    id: 'deep',
    title: 'Deep',
    levels: [
      { path: '', nodes: [{ id: 'box', label: 'Box', subtype: 'system', state: 'built' as const }, { id: 'out', label: 'Out', subtype: 'external-system', state: 'built' as const }], edges: [{ desc: 'the payload this edge carries', from: 'out', to: 'box', label: 'in' }] },
      { path: 'box', nodes: [{ id: 'stage', label: 'Stage', subtype: 'service-logic', state: 'built' as const }, { id: 'inner', label: 'Inner', subtype: 'service-logic', state: 'built' as const }], edges: [{ desc: 'the payload this edge carries', from: 'stage', to: 'inner', label: 'next' }], ports: { 'out->box': 'stage' } },
      { path: 'box/inner', nodes: [{ id: 'leaf', label: 'Leaf', subtype: 'service-logic', state: 'built' as const }], edges: [], ports: { 'stage->inner': 'leaf' } },
    ],
  } as never)
  const lv = fullView(model)
  // out stays, box is a frame, its two children become nodes, and inner is a frame too: out + stage + leaf
  assert.equal(lv.nodes.length, 3, 'every node of every level, with the drilled boxes replaced by frames')
  assert.equal((lv.groups ?? []).length, 2, 'one frame per drilled box, nested')
  const drawn = renderLevel(model, lv)
  assert.equal(drawn.audit.nodeNode, 0)
  assert.equal(drawn.audit.wireNode, 0)
  assert.equal(drawn.audit.groupNode, 0, 'a frame never covers a stranger')
})

test('a port that named a drilled host lands on the entry of its frame', async () => {
  const { composeInto } = await import('../src/expand.ts')
  const parent = {
    path: '',
    nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }, { id: 'host', label: 'Host', subtype: 'system', state: 'built' as const }],
    edges: [{ desc: 'the payload this edge carries', from: 'a', to: 'host', label: 'in' }],
    ports: { 'up->root': 'host' },
  }
  const child = {
    path: 'host',
    nodes: [{ id: 'first', label: 'First', subtype: 'service-logic', state: 'built' as const }],
    edges: [],
    flow: ['first->first'],
    ports: { 'a->host': 'first' },
  }
  const out = composeInto(parent as never, child as never, 'host', true)
  assert.equal(out.level.ports?.['up->root'], 'host/first', 'the outside edge enters the frame at its first stage')
})

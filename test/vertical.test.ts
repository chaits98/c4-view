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
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, subtype: 'service-logic', tech: 'ts' })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: `step${i}`, style: 'flow' })),
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
  const base = { id: 'm', title: 'M', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }] }
  assert.equal(parseModel({ ...base, layout: { direction: 'TB' } } as unknown as Model).layout?.direction, 'TB')
  assert.throws(() => parseModel({ ...base, layout: { direction: 'diagonal' } } as unknown as Model), /direction/)
})

test('an upright level still renders and still audits clean', () => {
  const model = parseModel({ id: 'v', title: 'V', levels: [chain(6)] } as unknown as Model)
  const drawn = renderLevel(model, model.levels[0])
  assert.equal(drawn.audit.ok, true)
  assert.match(drawn.svg, /<svg[^>]+height="[\d.]+"/)
})

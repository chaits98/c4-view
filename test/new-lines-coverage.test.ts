/**
 * The edges of the new model fields: every branch a caller can reach has to do something correct, not
 * merely exist. This file exists because the release gate demands 100% coverage on new lines — and
 * because each case here is a real way a model can be wrong.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModel, ModelError } from '../src/model.ts'
import { renderModel } from '../src/render.ts'
import { auditBanner } from '../src/viewer-page.ts'
import type { AuditReport } from '../src/types.ts'

const one = (node: Record<string, unknown>) => ({
  id: 'x', title: 'x',
  levels: [{ path: '', nodes: [{ id: 'a', label: 'Alpha', subtype: 'microservice', state: 'built', ...node }], edges: [], flow: [] }],
})

const svgOf = (node: Record<string, unknown>) => renderModel(parseModel(one(node)), '', undefined, undefined, true).levels[0].svg
const errorsOf = (node: Record<string, unknown>): string => {
  try { parseModel(one(node)); return '' } catch (e) {
    assert.ok(e instanceof ModelError)
    return e.message
  }
}

/** The drawn box, read from the node's own path: `M0 yH<w>V<y+h>H0Z`. */
const boxOf = (svg: string): { w: number; h: number } => {
  const m = /<path d="M([-\d.]+) ([-\d.]+)H([-\d.]+)V([-\d.]+)H/.exec(svg)
  assert.ok(m, 'no box path in the svg')
  return { w: Number(m![3]) - Number(m![1]), h: Number(m![4]) - Number(m![2]) }
}

test('size: one axis, both axes, and a request smaller than the text', () => {
  const plain = boxOf(svgOf({}))
  const wide = boxOf(svgOf({ size: { w: 400 } }))
  const tall = boxOf(svgOf({ size: { h: 140 } }))
  const tiny = boxOf(svgOf({ size: { w: 10, h: 10 } }))
  // one axis grows only itself; a too-small request is a floor, so the box stays text-sized
  assert.ok(wide.w > plain.w, 'w floor did not apply')
  assert.equal(wide.h, plain.h)
  assert.ok(tall.h > plain.h, 'h floor did not apply')
  assert.equal(tiny.w, plain.w)
  assert.equal(tiny.h, plain.h)
})

test('size and links: shape errors are refused by name', () => {
  assert.match(errorsOf({ size: 'big' }), /size: must be an object/)
  assert.match(errorsOf({ size: [1, 2] }), /size: must be an object/)
  assert.match(errorsOf({ size: { w: 0 } }), /size\.w: must be a positive number/)
  assert.match(errorsOf({ size: { h: -3 } }), /size\.h: must be a positive number/)
  assert.match(errorsOf({ size: { w: '400' } }), /size\.w: must be a positive number/)
  assert.match(errorsOf({ links: 'https://x' }), /links: must be an array/)
  assert.match(errorsOf({ links: [{ label: 'x' }] }), /href: must be a string/)
  assert.match(errorsOf({ links: [{ href: 42 }] }), /href: must be a string/)
  assert.match(errorsOf({ links: Array.from({ length: 6 }, () => ({ href: 'https://x' })) }), /at most 5/)
})

test('links: a label may be omitted, a non-object entry is skipped, http(s) is the only scheme', () => {
  const svg = svgOf({ links: [{ href: 'https://wiki/1' }] })
  assert.match(svg, /aria-label="https:\/\/wiki\/1"/)                 // label defaults to the href
  // a junk entry is refused, not skipped: a link that cannot be read is a broken promise, not noise
  assert.match(errorsOf({ links: ['nope', { href: 'http://ok/2' }] }), /href: must be a string/)
  assert.match(errorsOf({ links: [{ href: 'ftp://x' }] }), /only http\(s\)/)
})

test('the chip counts when there is more than one link, and does not when there is one', () => {
  const single = svgOf({ links: [{ label: 'one', href: 'https://a/1' }] })
  assert.ok(single.includes('>↗<'), 'a single link should carry a bare glyph')
  const many = svgOf({ links: [{ label: 'one', href: 'https://a/1' }, { label: 'two', href: 'https://a/2' }] })
  assert.ok(many.includes('>↗2<'), 'two links should be counted on the glyph')
  assert.ok(many.includes('one · two'), 'the title should name every link')
})

test('only planned is drawn dashed; partial and retired are solid; built draws nothing', () => {
  assert.match(svgOf({ state: 'planned' }), /stroke-dasharray="3 2"/)
  assert.doesNotMatch(svgOf({ state: 'partial' }), /stroke-dasharray/)
  assert.doesNotMatch(svgOf({ state: 'retired' }), /stroke-dasharray/)
  assert.doesNotMatch(svgOf({ state: 'built' }), /c4-state/)
})

test('the banner truncates a long list of undeclared nodes', () => {
  const report: AuditReport = {
    level: '', nodes: 4, edges: 0, nodeNode: 0, wireNode: 0, wireWire: 0, crossings: 0, chipChip: 0,
    chipNode: 0, groupNode: 0, ok: false, dense: false, crossingsPerEdge: 0, verdict: 'crisp',
    backward: 0, aspect: 1, unstated: ['a', 'b', 'c', 'd'],
  }
  assert.match(auditBanner(report), /4 node\(s\) declare no state \(a, b, c, …\)/)
})

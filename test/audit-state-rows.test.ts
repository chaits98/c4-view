/**
 * The two places a state finding has to reach a human: the one-line audit text and the banner above the
 * canvas. Both are list-shaped, not counts, and both must say WHICH boxes are undeclared or unbuilt —
 * a page that says "failed" without naming the node sends the reader hunting.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditLine } from '../src/audit.ts'
import { auditBanner } from '../src/viewer-page.ts'
import type { AuditReport } from '../src/types.ts'

const base: AuditReport = {
  level: '', nodes: 3, edges: 0, nodeNode: 0, wireNode: 0, wireWire: 0, crossings: 0, chipChip: 0,
  chipNode: 0, groupNode: 0, ok: true, dense: false, crossingsPerEdge: 0, verdict: 'crisp', backward: 0, aspect: 1,
}

test('the line names undeclared and unbuilt nodes', () => {
  const line = auditLine({ ...base, ok: false, unstated: ['a', 'b'], unbuilt: ['c:planned'] })
  assert.match(line, /unstated=2 \(a, b\)/)
  assert.match(line, /unbuilt=1 \(c:planned\)/)
})

test('more than three ids are truncated, and neither list prints when empty', () => {
  const line = auditLine({ ...base, ok: false, unstated: ['a', 'b', 'c', 'd'], unbuilt: [] })
  assert.match(line, /unstated=4 \(a, b, c, …\)/)
  const clean = auditLine(base)
  assert.doesNotMatch(clean, /unstated|unbuilt/)
})

test('the banner lists state findings even when no geometry gate failed', () => {
  const html = auditBanner({ ...base, ok: false, unstated: ['a'], unbuilt: ['b:partial'] })
  assert.match(html, /failed its audit/)
  assert.match(html, /1 node\(s\) declare no state \(a\)/)
  assert.match(html, /1 node\(s\) are not built \(b:partial\)/)
})

test('a clean report renders no banner at all', () => {
  assert.equal(auditBanner(base), '')
})

/**
 * The summary line after a refused model. It has to name the cause: "geometry" for a box that IS drawn
 * correctly sends the reader to fix coordinates, when the real fault is an undeclared state.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failureReasons } from '../src/cli-output.ts'
import type { AuditReport } from '../src/types.ts'

const clean: AuditReport = {
  level: '', nodes: 1, edges: 0, nodeNode: 0, wireNode: 0, wireWire: 0, crossings: 0, chipChip: 0,
  chipNode: 0, groupNode: 0, ok: true, dense: false, crossingsPerEdge: 0, verdict: 'crisp', backward: 0, aspect: 1,
}

test('a geometry failure says geometry, and only geometry', () => {
  assert.equal(failureReasons([{ ...clean, ok: false, nodeNode: 1 }]), '1 on geometry')
})

test('a model with no state fields at all is a geometry verdict, not a crash', () => {
  // the `?? 0` path: reports built by older code carry neither list
  assert.equal(failureReasons([{ ...clean, ok: false, wireNode: 2 }]), '1 on geometry')
})

test('a state failure says state, and a mixed model says both', () => {
  assert.equal(failureReasons([{ ...clean, ok: false, unstated: ['a'] }]), '1 on declared state')
  assert.equal(
    failureReasons([
      { ...clean, ok: false, nodeNode: 1 },
      { ...clean, ok: false, unbuilt: ['b:planned'] },
    ]),
    '1 on geometry, 1 on declared state',
  )
})

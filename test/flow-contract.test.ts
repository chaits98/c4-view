/**
 * The flow driver's geometry contract.
 *
 * The bug this file exists for: the full view draws each level inside its own `<svg>`, and every level
 * numbers its own steps from 1. The driver walks them in picture order — but a point on a nested edge is in
 * that picture's coordinates while the dot lives in the root picture, so the dot drifted off the wire for
 * every edge that was not on the root level. Reading a coordinate and writing it down is only correct when
 * both ends are in the same space.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const flow = readFileSync(new URL('../public/flow.js', import.meta.url), 'utf8')

test('the driver reads steps from every picture, not only the first one', () => {
  assert.match(flow, /stage\.querySelectorAll\('path\[data-flow\]'\)/, 'nested pictures carry their own steps')
  assert.match(flow, /pictureOf|picture:/, 'and each edge remembers which picture it came from')
})

test('a point from a nested picture is mapped into the root picture before the dot is placed', () => {
  assert.match(flow, /matrixTransform\(/, 'the point is transformed, not copied')
  assert.match(flow, /getScreenCTM\(\)\.inverse\(\)/, 'into the space the dot is drawn in')
  // the raw getPointAtLength result must never reach the dot directly
  assert.ok(!/dot\.setAttribute\('cx', String\(point\.x\)\)/.test(flow), 'no untransformed coordinate reaches the dot')
})

/**
 * `state` says how real a box is. Absent means built; anything else is drawn as a corner tag AND fails
 * the audit — a picture of a roadmap must never be mistakable for a picture of the system.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModel, ModelError } from '../src/model.ts'
import { renderModel } from '../src/render.ts'


const model = (state?: string) => ({
  id: 'st',
  title: 'st',
  levels: [{
    path: '',
    nodes: [{ id: 'a', label: 'Alpha', subtype: 'system', ...(state ? { state } : {}) }],
    edges: [],
    flow: [],
  }],
})

test('all four states parse; an unknown one is refused by name', () => {
  for (const s of ['built', 'planned', 'partial', 'retired']) {
    assert.doesNotThrow(() => parseModel(model(s)), s)
  }
  assert.throws(() => parseModel(model('shipped')), (e: unknown) => {
    assert.ok(e instanceof ModelError)
    assert.ok(String(e.message).includes('one of built | planned | partial | retired'), String(e.message))
    return true
  })
})

test('no state draws no tag, but the audit refuses the page', () => {
  const parsed = parseModel(model())
  const rendered = renderModel(parsed, '', undefined, undefined, true)
  assert.equal(rendered.levels[0].svg.includes('c4-state'), false, 'absence must not draw a badge')
  assert.equal(rendered.levels[0].audit.ok, false, 'an undeclared box must fail the audit')
  assert.deepEqual(rendered.levels[0].audit.unstated, ['a'])
})

test('an explicit built state passes and still draws nothing', () => {
  const parsed = parseModel(model('built'))
  const rendered = renderModel(parsed, '', undefined, undefined, true)
  assert.equal(rendered.levels[0].svg.includes('c4-state'), false)
  assert.equal(rendered.levels[0].audit.ok, true)
})

test('a non-built state draws its tag and fails the audit, naming the node', () => {
  const parsed = parseModel(model('planned'))
  const svg = renderModel(parsed, '', undefined, undefined, true).levels[0].svg
  assert.ok(/data-state="planned"/.test(svg), 'the tag is missing from the svg')
  assert.ok(/PLANNED/.test(svg), 'the tag carries no word')

  // the report the CLI prints is the one renderModel computes — read it from there, not from a
  // hand-built Placed/Routed pair that can drift from the real pipeline
  const report = renderModel(parsed, '', undefined, undefined, true).levels[0].audit
  assert.equal(report.ok, false)
  assert.deepEqual(report.unbuilt, ['a:planned'])
})

/**
 * The lens check: is a drill level the inside of one box, or the layer above wearing its name?
 *
 * These are the failures the graded runs actually produced — an orphan path nobody can click, and a
 * level that re-draws the ring it came from. Both pass every geometry gate, which is why they need
 * their own check.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseModel } from '../src/model.ts'
import { edgeKey, hostOf, lensLine, lensReport } from '../src/lens.ts'
import type { Model } from '../src/types.ts'

const base = (): Model => {
  const raw = JSON.parse(readFileSync(new URL('../examples/lens.json', import.meta.url), 'utf8')) as unknown
  return parseModel(raw)
}

const level = (model: Model, path: string) => model.levels.find((l) => l.path === path)!

test('the shipped lens example is clean', () => {
  const report = lensReport(base())
  assert.deepEqual(report.problems, [])
  assert.equal(lensLine(report), 'LENS ok')
})

test('a path that names no node in the parent is an orphan lens', () => {
  const model = base()
  level(model, 'context1').path = 'nowhere'
  const report = lensReport(model)
  assert.equal(report.problems.length, 1)
  assert.match(report.problems[0], /"nowhere" is not a node of the parent level/)
  assert.match(report.problems[0], /user, context1, context2, context3/, 'the message names the ids that do exist')
})

test('a level whose parent does not exist says so', () => {
  const model = base()
  level(model, 'context1').path = 'ghost/context1'
  assert.match(lensReport(model).problems[0], /parent level "ghost" does not exist/)
})

test('ports on the root level are rejected at parse time', () => {
  const raw = JSON.parse(readFileSync(new URL('../examples/lens.json', import.meta.url), 'utf8')) as Record<string, unknown>
  ;(raw.levels as Array<Record<string, unknown>>)[0].ports = { 'a->b': 'c' }
  assert.throws(() => parseModel(raw), /the root level has no parent/)
})

test('a port whose target is not in the level is rejected at parse time', () => {
  const raw = JSON.parse(readFileSync(new URL('../examples/lens.json', import.meta.url), 'utf8')) as Record<string, unknown>
  ;(raw.levels as Array<Record<string, unknown>>)[1].ports = { 'user->context1': 'nope' }
  assert.throws(() => parseModel(raw), /unknown node "nope"/)
})

test('every parent edge that touches the host needs a port', () => {
  const model = base()
  level(model, 'context1').ports = { 'user->context1': 'a' }
  const problems = lensReport(model).problems
  assert.equal(problems.length, 2, 'both outbound edges are uncovered')
  assert.ok(problems.some((p) => p.includes('context1->context2')))
  assert.ok(problems.some((p) => p.includes('would vanish when expanded')))
})

test('a port naming an edge the parent does not have is a problem', () => {
  const model = base()
  level(model, 'context1').ports = { ...level(model, 'context1').ports, 'user->nope': 'a' }
  assert.ok(lensReport(model).problems.some((p) => /"user->nope" is not an edge of the parent level/.test(p)))
})

test('a port on an edge that never touches the host is a problem', () => {
  const model = base()
  level(model, '').edges.push({ from: 'context2', to: 'context3', label: 'talks' })
  level(model, 'context1').ports = { ...level(model, 'context1').ports, 'context2->context3': 'a' }
  assert.ok(lensReport(model).problems.some((p) => /"context2->context3" does not touch "context1"/.test(p)))
})

test('the host may not appear inside its own lens', () => {
  const model = base()
  level(model, 'context1').nodes.push({ id: 'context1', label: 'Context 1 again', subtype: 'system' })
  assert.ok(lensReport(model).problems.some((p) => /contains "context1" itself/.test(p)))
})

test('a sibling of the host may not be re-drawn inside it', () => {
  const model = base()
  level(model, 'context1').nodes.push({ id: 'context2', label: 'Context 2 again', subtype: 'external-system' })
  assert.ok(lensReport(model).problems.some((p) => /re-draws context2 from the level above/.test(p)))
})

test('a drill level whose box has crossing edges and no ports is a failure', () => {
  const model = base()
  delete level(model, 'context1').ports
  const report = lensReport(model)
  assert.equal(report.problems.length, 1)
  assert.match(report.problems[0], /3 edge\(s\) cross into "context1" but no ports say where they land/)
  assert.equal(lensLine(report), 'LENS FAIL 1 problem(s)')
})

test('the root level never warns — there is nothing above it', () => {
  const model = base()
  model.levels = model.levels.filter((l) => l.path === '')
  assert.deepEqual(lensReport(model), { problems: [] })
})

test('edgeKey and hostOf agree with the path convention', () => {
  const model = base()
  assert.equal(edgeKey({ from: 'a', to: 'b' }), 'a->b')
  const deep = hostOf({ path: 'context2/router', nodes: [], edges: [] }, model)
  assert.equal(deep.hostId, 'router')
  assert.equal(deep.parent, undefined, 'context2 is a node, not a level, so there is no parent level')
  const shallow = hostOf(level(model, 'context1'), model)
  assert.equal(shallow.hostId, 'context1')
  assert.equal(shallow.parent, model.levels[0])
})

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

test('a child level that repeats a parent box with the same identity is composing, not leaking', () => {
  const raw = {
    id: 'merge', title: 'Merge',
    levels: [
      {
        path: '',
        nodes: [{ id: 'host', label: 'Host', subtype: 'system' }, { id: 'ext', identity: 'E-1', label: 'Ext', subtype: 'external-system' }, { id: 'sink', label: 'Sink', subtype: 'file-storage' }],
        edges: [{ from: 'ext', to: 'host' }, { from: 'host', to: 'sink' }],
      },
      {
        path: 'host', ports: { 'ext->host': 'a', 'host->sink': 'a' },
        nodes: [
          { id: 'ext', identity: 'E-1', label: 'Ext', subtype: 'external-system' },
          { id: 'a', label: 'A', subtype: 'service-logic' },
        ],
        edges: [{ from: 'ext', to: 'a' }],
      },
    ],
  }
  const report = lensReport(parseModel(raw as never))
  assert.deepEqual(report.problems, [], 'same id + same identity is the same box, not a re-draw')

  // the same id with a DIFFERENT identity is a genuine duplicate and is still refused
  const clash = JSON.parse(JSON.stringify(raw))
  clash.levels[1].nodes[0].identity = 'E-2'
  assert.ok(lensReport(parseModel(clash as never)).problems.some((p) => /re-draws ext/.test(p)))
})

/** Two levels that are correct, so a test can break exactly one thing. */
const pair = (): Record<string, any> => ({
  id: 'pair',
  title: 'Pair',
  levels: [
    {
      path: '',
      nodes: [{ id: 'a', identity: 'A-1', label: 'A', subtype: 'person' }, { id: 'host', identity: 'H-1', label: 'Host', subtype: 'system' }, { id: 'b', identity: 'B-1', label: 'B', subtype: 'external-system' }],
      edges: [{ from: 'a', to: 'host' }, { from: 'host', to: 'b' }],
      flow: ['a->host', 'host->b'],
    },
    {
      path: 'host',
      ports: { 'a->host': 'inner', 'host->b': 'inner' },
      nodes: [{ id: 'inner', identity: 'I-1', label: 'Inner', subtype: 'service-logic' }],
      edges: [],
    },
  ],
})

test('a declared flow that skips an edge is a problem: the viewer would append it silently', () => {
  const raw = pair()
  raw.levels[0].flow = ['a->host']
  const report = lensReport(parseModel(raw as never))
  assert.ok(report.problems.some((p) => /flow names 1 of 2 edge\(s\) — missing host->b/.test(p)), report.problems.join('\n'))
})

test('one id is one element: the same id with two identities is refused', () => {
  const raw = pair()
  raw.levels[1].nodes.push({ id: 'a', identity: 'A-2', label: 'A again', subtype: 'person' })
  const report = lensReport(parseModel(raw as never))
  assert.ok(report.problems.some((p) => /one id is one element/.test(p)), report.problems.join('\n'))
})

test('a box with no edges cannot be a lens: its page would have no doors', () => {
  const raw = pair()
  raw.levels[0].edges = []
  raw.levels[0].flow = []
  raw.levels[1].ports = {}
  const report = lensReport(parseModel(raw as never))
  assert.ok(report.problems.some((p) => /cannot be a lens/.test(p)), report.problems.join('\n'))
})

test('an id repeated with no identity on one side is still a clash', () => {
  const raw = pair()
  delete raw.levels[0].nodes[2].identity // the parent says nothing; the child still claims B-1
  raw.levels[1].nodes.push({ id: 'b', identity: 'X-9', label: 'B again', subtype: 'external-system' })
  const report = lensReport(parseModel(raw as never))
  assert.ok(report.problems.some((p) => /different identities \(none vs X-9\)/.test(p)), report.problems.join('\n'))
})

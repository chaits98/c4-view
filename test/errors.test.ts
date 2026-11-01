/**
 * The error paths. Every branch below is a message a human will read at the worst moment — a model that
 * will not parse, a port that points nowhere, a doc that is not there — so each one is asserted on its
 * words, not just on the fact that it throws.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelError, parseModel } from '../src/model.ts'
import { expandLevel } from '../src/expand.ts'
import { lensReport } from '../src/lens.ts'
import { levelDocs } from '../src/docs.ts'
import { renderModel } from '../src/render.ts'
import { readFileSync } from 'node:fs'

const lens = (): Record<string, any> =>
  JSON.parse(readFileSync(new URL('../examples/lens.json', import.meta.url), 'utf8')) as Record<string, any>

/** A one-level model, for the cases that only care about one node. */
const simple = (levels: unknown[]): Record<string, any> => ({ id: 'm', title: 'M', levels })

test('ports must be an object, and the key must look like an edge', () => {
  const raw = simple([{ path: '', title: 'Root', nodes: [{ id: 'a', label: 'A', subtype: 'microservice' }], edges: [] }])
  raw.levels[0].ports = 'nope'
  assert.throws(() => parseModel(raw), (error: Error) => {
    assert.ok(error instanceof ModelError)
    assert.match(error.message, /ports: must be an object/)
    return true
  })
})

test('a port on the root level is refused: there is nothing above it', () => {
  const raw = simple([{ path: '', title: 'Root', nodes: [{ id: 'a', label: 'A', subtype: 'microservice' }], edges: [], ports: { 'x->y': 'a' } }])
  assert.throws(() => parseModel(raw), /root level has no parent/)
})

test('a port key without "->" and a port target that is not a node id are both named', () => {
  const raw = simple([
    { path: '', title: 'Root', nodes: [{ id: 'host', label: 'Host', subtype: 'microservice' }], edges: [] },
    {
      path: 'host',
      title: 'Host',
      nodes: [{ id: 'inner', label: 'Inner', subtype: 'microservice' }],
      edges: [],
      ports: { 'no-arrow': 'inner', 'from->to': '   ', 'from->other': 'ghost' },
    },
  ])
  assert.throws(() => parseModel(raw), (error: Error) => {
    assert.match(error.message, /must look like "from->to"/)
    assert.match(error.message, /target must be a node id/)
    assert.match(error.message, /unknown node "ghost"/)
    return true
  })
})

test('a level whose parent does not exist says which parent it expected', () => {
  const raw = simple([{ path: '', title: 'Root', nodes: [{ id: 'a', label: 'A', subtype: 'microservice' }], edges: [] }, { path: 'gone/child', title: 'Child', nodes: [{ id: 'x', label: 'X', subtype: 'microservice' }], edges: [] }])
  const report = lensReport(parseModel(raw))
  assert.ok(report.problems.some((p) => /parent level "gone" does not exist/.test(p)), report.problems.join('\n'))
})

test('a port naming an edge the parent does not have is listed with the edges it does have', () => {
  const raw = lens()
  raw.levels[1].ports = { 'nobody->nowhere': 'a' }
  const report = lensReport(parseModel(raw))
  assert.ok(report.problems.some((p) => /is not an edge of the parent level/.test(p)), report.problems.join('\n'))
})

test('a port pointing at a node this level does not have is refused at parse time', () => {
  const raw = lens()
  raw.levels[1].ports = { 'user->context1': 'ghost' }
  assert.throws(() => parseModel(raw), /unknown node "ghost" in this level/)
})

test('an edge with no port cannot be expanded, and the message names the edge', () => {
  const raw = lens()
  delete raw.levels[1].ports['user->context1']
  const model = parseModel(raw)
  assert.throws(() => expandLevel(model, 'context1'), /touches "context1" but has no port/)
})

test('a port that points outside the interior is refused by the expansion', () => {
  // built as an object, not parsed: the parser refuses this model, so the expander's own guard is what is
  // under test — a caller holding a model from anywhere else still cannot get a silent empty picture
  const model = parseModel(lens())
  const child = model.levels.find((l) => l.path === 'context1')
  assert.ok(child)
  const broken = { ...model, levels: model.levels.map((l) => (l.path === 'context1' ? { ...l, ports: { 'user->context1': 'ghost' } } : l)) }
  void child
  assert.throws(() => expandLevel(broken, 'context1'), /points at "ghost", which is not in the level/)
})

test('flow survives composition: the child order is spliced where the packet enters', () => {
  const raw = lens()
  raw.levels[0].flow = ['user->context1', 'context1->context2']
  raw.levels[1].flow = ['a->b', 'b->d']
  const { level } = expandLevel(parseModel(raw), 'context1')
  assert.deepEqual(level.flow, ['user->context1/a', 'context1/a->context1/b', 'context1/b->context1/d', 'context1/d->context2'])
})

test('no flow on either side composes to no flow, rather than to an empty list', () => {
  const raw = lens()
  delete raw.levels[0].flow
  delete raw.levels[1].flow
  assert.deepEqual(expandLevel(parseModel(raw), 'context1').level.flow, [], 'an empty list, not an invented order')
})

test('a level with no docs yields an empty set, and one doc renders and the other does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-leveldocs-'))
  mkdirSync(join(dir, 'nodes'), { recursive: true })
  writeFileSync(join(dir, 'nodes', 'a.md'), '# A\n\nDoes a thing.')
  const level = { path: '', title: 'Root', nodes: [{ id: 'a', label: 'A', subtype: 'microservice' }, { id: 'b', label: 'B', subtype: 'microservice' }], edges: [{ from: 'a', to: 'b' }] }
  const docs = levelDocs(dir, level as never)
  assert.match(docs.nodes.a, /Does a thing/)
  assert.equal(docs.nodes.b, undefined, 'no file, no doc')
  assert.deepEqual(docs.edges, {}, 'an edge without a doc is simply absent')
})

test('every level of the sample renders, so the picture path has no branch left untried', () => {
  const model = parseModel(lens())
  for (const level of model.levels) {
    const rendered = renderModel(model, level.path)
    assert.equal(rendered.levels.length, 1)
    assert.equal(rendered.levels[0].path, level.path)
  }
  const expanded = renderModel(model, 'context1', undefined, 'context1')
  assert.equal(expanded.levels[0].path, 'context1', 'the expanded page is still addressed as the child level')
})

test('an edge doc is rendered when it exists, and skipped when it does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-edgedocs-'))
  mkdirSync(join(dir, 'nodes'), { recursive: true })
  mkdirSync(join(dir, 'edges'), { recursive: true })
  writeFileSync(join(dir, 'nodes', 'a.md'), '# A\n\nDoes a thing.')
  writeFileSync(join(dir, 'edges', 'a__b.md'), '# a to b\n\nThe hop.')
  const level = { path: '', title: 'Root', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }
  const docs = levelDocs(dir, level as never)
  assert.match(docs.edges['a->b'], /The hop/)
  assert.equal(docs.edges['b->a'], undefined, 'the other direction has no file')
})

test('a parent with no groups still expands, with the frame as the only group', () => {
  const raw = lens()
  delete raw.levels[0].groups
  const { level, frameId } = expandLevel(parseModel(raw), 'context1')
  assert.deepEqual(level.groups?.map((g) => g.id), [frameId])
})

test('a parent flow that never touches the host puts the child flow at the end', () => {
  const raw = lens()
  raw.levels[0].edges.push({ from: 'user', to: 'context2', label: 'ask' })
  raw.levels[0].flow = ['user->context2']
  raw.levels[1].flow = ['a->b']
  const { level } = expandLevel(parseModel(raw), 'context1')
  assert.equal(level.flow?.[level.flow.length - 1], 'context1/a->context1/b')
})

test('a child flow only composes to the child flow', () => {
  const raw = lens()
  delete raw.levels[0].flow
  raw.levels[1].flow = ['a->b']
  const { level } = expandLevel(parseModel(raw), 'context1')
  assert.deepEqual(level.flow, ['context1/a->context1/b'])
})

test('a parent flow edge that does not cross into the host survives verbatim', () => {
  const raw = lens()
  raw.levels[0].edges.push({ from: 'context2', to: 'context3', label: 'side' })
  raw.levels[0].flow = ['context2->context3', 'user->context1']
  raw.levels[1].flow = ['a->b']
  const { level } = expandLevel(parseModel(raw), 'context1')
  assert.equal(level.flow?.[0], 'context2->context3', 'no port to remap it through, so it stays itself')
  assert.equal(level.flow?.[1], 'user->context1/a')
})

test('a hand-built model with no groups and no flow still expands', () => {
  // parseModel always fills groups and omits an empty flow; a level assembled in code may do neither, and
  // the defaults in expandLevel are the only thing standing between that and a crash
  const hand = {
    id: 'hand',
    title: 'Hand',
    levels: [
      { path: '', nodes: [{ id: 'user', label: 'User', subtype: 'person' }, { id: 'host', label: 'Host', subtype: 'system' }], edges: [{ from: 'user', to: 'host' }] },
      { path: 'host', nodes: [{ id: 'a', label: 'A', subtype: 'service-logic' }], edges: [], ports: { 'user->host': 'a' } },
    ],
  } as unknown as Parameters<typeof expandLevel>[0]
  const { level } = expandLevel(hand, 'host')
  const ids = level.nodes.map((n) => n.id)
  assert.ok(ids.includes('host/a'), 'the interior is placed')
  assert.deepEqual(level.flow, [], 'no flow on either side, so none invented')
  assert.equal(level.groups?.length, 1, 'the frame is the only group')
})

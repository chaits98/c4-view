/**
 * The trust boundary: a model that parses is normalised, and every rejection
 * names the exact place the agent's JSON went wrong.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelError, childPath, drillTargets, layoutOf, levelOrder, parseModel } from '../src/model.ts'
import { DEFAULT_LAYOUT } from '../src/types.ts'

const base = (over: Record<string, unknown> = {}) => ({
  id: 'demo',
  title: 'Demo',
  levels: [
    {
      path: '',
      nodes: [
        { id: 'a', label: 'A', subtype: 'system' },
        { id: 'b', label: 'B', subtype: 'database', tech: 'sqlite' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'writes' }],
    },
  ],
  ...over,
})

test('parses a valid model and normalises the edge style', () => {
  const model = parseModel(base())
  assert.equal(model.levels.length, 1)
  assert.equal(model.levels[0].edges[0].style, 'flow')
  assert.deepEqual(layoutOf(model), DEFAULT_LAYOUT)
})

test('rejects an unknown edge target with the exact path', () => {
  const bad = base({
    levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [{ from: 'a', to: 'ghost' }] }],
  })
  assert.throws(() => parseModel(bad), (e: unknown) => {
    assert.ok(e instanceof ModelError)
    assert.match(e.message, /levels\[0\]\.edges\[0\]\.to: unknown node "ghost"/)
    return true
  })
})

test('rejects a self-loop instead of drawing an unreadable edge', () => {
  const bad = base({
    levels: [
      {
        path: '',
        nodes: [{ id: 'a', label: 'A', subtype: 'system' }],
        edges: [{ from: 'a', to: 'a' }],
      },
    ],
  })
  assert.throws(() => parseModel(bad), /self-loop/)
})

test('drops a duplicate edge but keeps the first label', () => {
  const model = parseModel(
    base({
      levels: [
        {
          path: '',
          nodes: [
            { id: 'a', label: 'A', subtype: 'system' },
            { id: 'b', label: 'B', subtype: 'system' },
          ],
          edges: [
            { from: 'a', to: 'b', label: 'first' },
            { from: 'a', to: 'b', label: 'second' },
          ],
        },
      ],
    }),
  )
  assert.equal(model.levels[0].edges.length, 1)
  assert.equal(model.levels[0].edges[0].label, 'first')
})

test('layout overrides merge over the defaults and reject unknown keys', () => {
  assert.equal(layoutOf(parseModel(base({ layout: { rankGap: 200 } }))).rankGap, 200)
  assert.throws(() => parseModel(base({ layout: { nonsense: 3 } })), /layout\.nonsense: unknown setting/)
})

test('drill paths follow the level path, root has no prefix', () => {
  assert.equal(childPath('', 'app'), 'app')
  assert.equal(childPath('app', 'db'), 'app/db')
  const model = parseModel({
    id: 'd',
    title: 'D',
    levels: [
      { path: '', nodes: [{ id: 'app', label: 'App', subtype: 'system' }], edges: [] },
      { path: 'app', nodes: [{ id: 'db', label: 'DB', subtype: 'database' }], edges: [] },
      { path: 'app/db', nodes: [{ id: 'x', label: 'X', subtype: 'function' }], edges: [] },
    ],
  })
  assert.deepEqual([...drillTargets(model, model.levels[0])], [['app', 'app']])
  assert.deepEqual(drillTargets(model, model.levels[1]).get('db'), 'app/db')
  assert.deepEqual(levelOrder(model).map((l) => l.path), ['', 'app', 'app/db'])
})

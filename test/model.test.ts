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

/**
 * The rejections, in one table: each row is a model an agent could actually write, and the fragment
 * of the path the error must name. A validator that stops naming *where* is as useless as one that
 * stops rejecting, so the message is part of the assertion.
 */
test('every malformed model is refused, naming the place it broke', () => {
  const withLevel = (level: Record<string, unknown>) => ({ ...base(), levels: [{ path: '', nodes: [], edges: [], ...level }] })
  const node = (over: Record<string, unknown>) => withLevel({ nodes: [{ id: 'a', label: 'A', subtype: 'system', ...over }] })
  const cases: Array<[string, unknown, RegExp]> = [
    ['not an object', 'nope', /must be a JSON object/],
    ['no id', { ...base(), id: undefined }, /id: required/],
    ['id with a space', { ...base(), id: 'not ok' }, /id: required/],
    ['no title', { ...base(), title: '   ' }, /title: required/],
    ['level not an object', { ...base(), levels: [42] }, /levels\[0\]: must be an object/],
    ['level path not a string', { ...base(), levels: [{ path: 7, nodes: [], edges: [] }] }, /path|level/i],
    ['nodes not an array', { ...base(), levels: [{ path: '', nodes: 'a', edges: [] }] }, /nodes/i],
    ['edges not an array', { ...base(), levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: 5 }] }, /edges/i],
    ['groups not an array', { ...base(), levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [], groups: {} }] }, /groups/i],
    ['flow not an array', { ...base(), levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [], flow: 7 }] }, /flow/i],
    ['node not an object', withLevel({ nodes: [7] }), /nodes\[0\]: must be an object/],
    ['node with no id', node({ id: undefined }), /nodes\[0\]\.id: required/],
    ['node with no label', node({ label: '' }), /nodes\[0\]\.label: required/],
    ['unknown subtype', node({ subtype: 'blob' }), /subtype: not a C4 subtype \(blob\)/],
    ['missing subtype', node({ subtype: undefined }), /subtype: not a C4 subtype \(missing\)/],
    ['non-string tech', node({ tech: 22 }), /nodes\[0\]\.tech: must be a string when present/],
    ['non-string desc', node({ desc: 1 }), /nodes\[0\]\.desc: must be a string when present/],
    ['non-string identity', node({ identity: [] }), /nodes\[0\]\.identity: must be a string when present/],
    ['non-string group', node({ group: {} }), /nodes\[0\]\.group: must be a string when present/],
    ['edge not an object', withLevel({ edges: ['a→b'] }), /edges\[0\]: must be an object/],
    ['edge with an unknown from', withLevel({ edges: [{ from: 'ghost', to: 'a' }] }), /edges\[0\]\.from: unknown node "ghost"/],
    ['edge with an unknown to', withLevel({ edges: [{ from: 'a', to: 'ghost' }] }), /edges\[0\]\.to: unknown node "ghost"/],
    ['edge label of the wrong type', withLevel({ nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [{ from: 'a', to: 'a', label: 3 }] }), /label: must be a string when present/],
    ['unknown edge style', withLevel({ nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [{ from: 'a', to: 'a', style: 'dotted' }] }), /style: one of flow\\|dep\\|tent\\|dir/],
    ['group not an object', withLevel({ groups: [1] }), /groups\[0\]: must be an object/],
    ['group with no label', withLevel({ groups: [{ id: 'g' }] }), /groups\[0\]\.label: required/],
    ['flow naming a missing edge', withLevel({ flow: ['a->b'] }), /flow\[0\]: "a->b" is not an edge of this level/],
    ['layout not an object', { ...base(), layout: 'wide' }, /layout: must be an object when present/],
    ['node rank not a number', node({ rank: 'x' }), /nodes\[0\]\.rank: must be a non-negative integer/],
    ['node rank NaN', node({ rank: Number.NaN }), /nodes\[0\]\.rank: must be a non-negative integer/],
    ['node rank not an integer', node({ rank: 1.5 }), /nodes\[0\]\.rank: must be a non-negative integer/],
    ['node rank below zero', node({ rank: -1 }), /nodes\[0\]\.rank: must be a non-negative integer/],
    ['no levels at all', { ...base(), levels: [] }, /at least one level/],
    ['group with non-string members', withLevel({ nodes: [{ id: 'a', label: 'A', subtype: 'system' }], groups: [{ id: 'g', label: 'G', members: [1, 2] }] }), /groups\[0\]/],
    ['group naming a node that is not in the level', withLevel({ nodes: [{ id: 'a', label: 'A', subtype: 'system' }], groups: [{ id: 'g', label: 'G', members: ['ghost'] }] }), /groups\[0\]/],
    ['edge style that is not a string', withLevel({ nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [{ from: 'a', to: 'a', style: 5 }] }), /style/],
  ]
  for (const [name, model, expected] of cases) {
    assert.throws(
      () => parseModel(model),
      (error: Error) => error instanceof ModelError && expected.test(error.message),
      name,
    )
  }
})

test('an optional field is normalised, and a bare level gets a name', () => {
  const model = parseModel({
    ...base(),
    levels: [
      { nodes: [{ id: 'a', label: 'A', subtype: 'system', tech: 'x', desc: 'y', identity: 'z', group: 'g' }], edges: [] },
      { path: 'a', title: '', nodes: [{ id: 'b', label: 'B', subtype: 'system' }, { id: 'c', label: 'C', subtype: 'system' }], edges: [{ from: 'b', to: 'c' }] },
    ],
  })
  const [overview, child] = model.levels
  assert.equal(overview.path, '', 'a level with no path is the overview')
  assert.equal(overview.title, 'Overview', 'and it is named')
  assert.deepEqual(
    { tech: overview.nodes[0].tech, desc: overview.nodes[0].desc, identity: overview.nodes[0].identity, group: overview.nodes[0].group },
    { tech: 'x', desc: 'y', identity: 'z', group: 'g' },
    'every present optional survives',
  )
  assert.equal(child.title, 'a', 'a blank title falls back to the path')
  const numericTitle = parseModel({ ...base(), levels: [{ path: 'x', title: 7, nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }] })
  assert.equal(numericTitle.levels[0].title, 'x', 'a title that is not a string falls back too')
  assert.equal(child.edges[0].style, 'flow', 'an edge with no style is a flow')
  assert.equal(child.edges[0].label, undefined, 'and keeps no empty label')
})

test('a layout knob that cannot work is refused, not silently ignored', () => {
  const withLayout = (layout: Record<string, unknown>) => ({ ...base(), layout })
  assert.throws(() => parseModel(withLayout({ direction: 'TB' })), /"TB" is not implemented — use "LR"/, 'top-to-bottom is not built')
  assert.throws(() => parseModel(withLayout({ direction: 'diagonal' })), /direction: "LR"/, 'and neither is anything else')
  assert.throws(() => parseModel(withLayout({ rankGap: 0 })), /layout\.rankGap: must be a positive number/)
  assert.throws(() => parseModel(withLayout({ rankGap: 'wide' })), /layout\.rankGap: must be a positive number/)
  // JSON cannot carry these, but parseModel takes any object — so the guard is real, not decorative
  assert.throws(() => parseModel(withLayout({ rankGap: Number.NaN })), /layout\.rankGap: must be a positive number/)
  assert.throws(() => parseModel(withLayout({ rankGap: Number.POSITIVE_INFINITY })), /layout\.rankGap: must be a positive number/)
  assert.throws(() => parseModel(withLayout({ gap: 8 })), /layout\.gap: unknown setting/, 'a typo is named, not ignored')
  const kept = parseModel(withLayout({ direction: 'LR', rankGap: 96 }))
  assert.deepEqual({ ...layoutOf(kept) }, { ...DEFAULT_LAYOUT, direction: 'LR', rankGap: 96 }, 'known knobs are kept')
})

test('a fully specified model keeps every field it was given', () => {
  const full = parseModel({
    ...base(),
    layout: { direction: 'LR', rankGap: 140, nodeGap: 40, lane: 14, portGap: 14, labelMaxChars: 40, fontSize: 14, nodePadX: 16, nodePadY: 12, minW: 130 },
    levels: [
      {
        path: '',
        title: 'Everything',
        nodes: [
          { id: 'a', label: 'A', subtype: 'system', tech: 'Node', desc: 'd', identity: 'i', group: 'g', rank: 0 },
          { id: 'b', label: 'B', subtype: 'microservice', tech: '', desc: '', identity: '', group: '' },
        ],
        edges: [{ from: 'a', to: 'b', label: 'calls', style: 'dep' }],
        groups: [{ id: 'g', label: 'Group', members: ['a', 7, null, 'b'] }],
        flow: ['a->b'],
      },
    ],
  })
  assert.deepEqual(full.layout, { direction: 'LR', rankGap: 140, nodeGap: 40, lane: 14, portGap: 14, labelMaxChars: 40, fontSize: 14, nodePadX: 16, nodePadY: 12, minW: 130 })
  const level = full.levels[0]
  assert.equal(level.title, 'Everything')
  assert.equal(level.nodes[0].rank, 0, 'a direct rank is kept')
  assert.equal(level.nodes[1].tech, '', 'an empty string is still a string')
  assert.deepEqual(level.groups?.[0].members, ['a', 'b'], 'non-strings in members are dropped')
  assert.deepEqual(level.flow, ['a->b'])
  assert.equal(level.edges[0].style, 'dep')
})

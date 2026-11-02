/** The full view: every level drawn in place, inside its host's box. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModel } from '../src/model.ts'
import { nestedLevel, nestedPicture, NEST_HEAD, NEST_PAD } from '../src/nest.ts'

const deep = (): ReturnType<typeof parseModel> =>
  parseModel({
    id: 'deep',
    title: 'Deep',
    levels: [
      {
        path: '',
        nodes: [{ id: 'box', label: 'Box', subtype: 'system' }, { id: 'out', label: 'Out', subtype: 'external-system' }],
        edges: [{ from: 'out', to: 'box', label: 'in' }],
      },
      {
        path: 'box',
        nodes: [{ id: 'stage', label: 'Stage', subtype: 'service-logic' }, { id: 'inner', label: 'Inner', subtype: 'service-logic' }],
        edges: [{ from: 'stage', to: 'inner', label: 'next' }],
        ports: { 'out->box': 'stage' },
      },
      {
        path: 'box/inner',
        nodes: [{ id: 'leaf', label: 'Leaf', subtype: 'service-logic' }],
        edges: [],
        ports: { 'stage->inner': 'leaf' },
      },
    ],
  } as never)

test('every level is drawn, once each, and counted', () => {
  const pic = nestedPicture(deep())
  assert.equal(pic.levels, 3)
  assert.equal(pic.nodes, 5, 'two on the root, two in box, one in box/inner')
  assert.equal(pic.edges, 2, 'one per level that has any')
  assert.equal((pic.svg.match(/class="c4-nested"/g) ?? []).length, 2, 'two hosts hold a child drawing')
})

test('a child drawing sits inside its host box, not over the label', () => {
  const pic = nestedPicture(deep())
  const host = pic.hosts.get('box')
  assert.ok(host, 'the root level knows where its host box is')
  const at = /translate\((\d+) (\d+)\)" class="c4-nested" data-host="box"/.exec(pic.svg)
  assert.ok(at, 'the child is placed with a translate')
  const [x, y] = [Number(at[1]), Number(at[2])]
  assert.ok(x >= host.x && y >= host.y, 'inside the box')
  assert.equal(y, Math.round(host.y + NEST_PAD + NEST_HEAD), 'below the label strip')
})

test('the report is the sum of the levels, not a fresh clean sheet', () => {
  const pic = nestedPicture(deep())
  assert.equal(pic.audit.nodes, pic.nodes)
  assert.equal(pic.audit.edges, pic.edges)
  assert.equal(typeof pic.audit.crossingsPerEdge, 'number')
  assert.ok(['crisp', 'ok', 'dense', 'over'].includes(pic.audit.verdict))
})

test('the level shape the viewer takes carries the picture and its size', () => {
  const one = nestedLevel(deep())
  assert.equal(one.path, 'full')
  assert.match(one.svg, /<svg/)
  assert.ok(one.audit.aspect > 0)
})

test('a model with no root level draws nothing rather than throwing', () => {
  const pic = nestedPicture({ id: 'x', title: 'X', levels: [] } as never)
  assert.equal(pic.levels, 0)
  assert.equal(pic.svg, '')
})

test('the full page still has a text version when the model has no root level', async () => {
  const { viewerPage } = await import('../src/viewer-page.ts')
  const model = { id: 'x', title: 'X', layout: {}, levels: [{ path: 'only', nodes: [], edges: [] }] } as never
  const page = viewerPage(model, 'only', null, 'auto', undefined, undefined, nestedLevel(model))
  assert.match(page, /data-view="full" aria-current="true"/)
})

test('a host that holds a drawing is a rectangle, whatever its subtype draws as', () => {
  const pic = nestedPicture(deep())
  assert.ok(!/A\d+/.test(pic.svg.split('data-host="box"')[0].slice(-400)), 'no stadium arc on the host outline')
  assert.match(pic.svg, /data-host="box"/)
})

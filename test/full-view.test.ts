/**
 * The full view: every level opened at once, the mode toggle, and the seams that make nesting work.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModel } from '../src/model.ts'
import { fullView, parentPath } from '../src/expand-all.ts'
import { composeInto } from '../src/expand.ts'
import { renderAll, renderLevel } from '../src/render.ts'
import { viewerPage } from '../src/viewer-page.ts'

const nested = (): ReturnType<typeof parseModel> =>
  parseModel({
    id: 'deep',
    title: 'Deep',
    levels: [
      {
        path: '',
        nodes: [{ id: 'box', label: 'Box', subtype: 'system', state: 'built' as const }, { id: 'out', label: 'Out', subtype: 'external-system', state: 'built' as const }],
        edges: [{ desc: 'the payload this edge carries', from: 'out', to: 'box', label: 'in' }],
      },
      {
        path: 'box',
        nodes: [{ id: 'stage', label: 'Stage', subtype: 'service-logic', state: 'built' as const }, { id: 'inner', label: 'Inner', subtype: 'service-logic', state: 'built' as const }],
        edges: [{ desc: 'the payload this edge carries', from: 'stage', to: 'inner', label: 'next' }],
        ports: { 'out->box': 'stage' },
        flow: ['stage->inner'],
      },
      {
        path: 'box/inner',
        nodes: [{ id: 'leaf', label: 'Leaf', subtype: 'service-logic', state: 'built' as const }],
        edges: [],
        ports: { 'stage->inner': 'leaf' },
        flow: [],
      },
    ],
  } as never)

test('parentPath reads the level above, and the root is its own parent', () => {
  assert.equal(parentPath('box/inner'), 'box')
  assert.equal(parentPath('box'), '')
  assert.equal(parentPath(''), '')
})

test('the full view renders as one picture and carries its own title', () => {
  const model = nested()
  const all = renderAll(model)
  assert.equal(all.levels.length, 1, 'one page')
  assert.match(all.title, /every level/)
  assert.match(all.levels[0].svg, /data-host=|data-group/, 'the host frames are drawn')
})

test('nesting survives the fold: an outer frame encloses its own nested frames', () => {
  const lv = fullView(nested())
  const frames = (lv.groups ?? []).map((g) => g.id)
  assert.deepEqual(frames.sort(), ['box/frame-inner', 'frame-box'].sort(), 'both frames exist, the inner one prefixed')
  const outer = (lv.groups ?? []).find((g) => g.id === 'frame-box')
  assert.ok(outer?.members.some((m) => m.startsWith('box/')), 'the outer frame holds the inner one’s contents too')
})

test('a host with no flow still gives its frame an entry', () => {
  const parent = {
    path: '',
    nodes: [{ id: 'host', label: 'Host', subtype: 'system', state: 'built' as const }, { id: 'sib', label: 'Sib', subtype: 'system', state: 'built' as const }],
    edges: [],
    ports: { 'up->root': 'host' },
  }
  const child = { path: 'host', nodes: [{ id: 'only', label: 'Only', subtype: 'service-logic', state: 'built' as const }], edges: [] }
  const out = composeInto(parent as never, child as never, 'host', true)
  assert.equal(out.level.ports?.['up->root'], 'host/only', 'the first node is the entry')
})

test('the page offers both modes, and full is marked when it is full', () => {
  const model = nested()
  const drill = viewerPage(model, '')
  assert.match(drill, /data-view="drill" aria-current="true"/)
  assert.match(drill, /data-view="full"/)
  const full = viewerPage(model, '', null, 'auto', undefined, fullView(model))
  assert.match(full, /data-view="full" aria-current="true"/, 'full is the current mode on the full page')
  assert.match(full, /view=full/, 'and the drill link points back at the level page')
})

test('the full picture audits clean when the model is sound', () => {
  const drawn = renderLevel(nested(), fullView(nested()))
  assert.equal(drawn.audit.nodeNode, 0)
  assert.equal(drawn.audit.wireNode, 0)
  assert.equal(drawn.audit.groupNode, 0)
})

test('the CLI can render the whole model in one file', async () => {
  const { run } = await import('../src/cli.ts')
  const { mkdtempSync, writeFileSync, existsSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'c4v-all-'))
  const file = join(dir, 'm.json')
  writeFileSync(file, JSON.stringify({
    id: 'cli-all',
    title: 'CLI all',
    levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }], edges: [] }],
  }))
  const out = join(dir, 'out')
  assert.equal(await run(['render', file, '--all', '--out', out]), 0)
  const svg = join(out, 'full.svg')
  assert.ok(existsSync(svg), 'one file, named after the mode')
  assert.match(readFileSync(svg, 'utf8'), /<svg/)
})

test('a port is matched by its far side when the outside end has been composed', () => {
  // the parent's edge already ends in `cli/args`; the child's port still says `cli->server`
  const parent = {
    path: '',
    nodes: [{ id: 'cli/args', label: 'Args', subtype: 'service-logic', state: 'built' as const }, { id: 'server', label: 'Server', subtype: 'microservice', state: 'built' as const }],
    edges: [{ desc: 'the payload this edge carries', from: 'cli/args', to: 'server', label: 'starts' }],
  }
  const child = {
    path: 'c4view/server',
    nodes: [{ id: 'routes', label: 'Routes', subtype: 'service-logic', state: 'built' as const }],
    edges: [],
    // the host is the SECOND end here, and one port names the host at neither end
    ports: { 'nobody->anyone': 'routes', 'cli->server': 'routes' },
  }
  const out = composeInto(parent as never, child as never, 'server', true)
  assert.equal(out.level.nodes.length, 2, 'the outside end and the interior node')
  assert.ok(out.level.edges.some((e) => e.to === 'server/routes'), 'the edge landed on the port target')
})

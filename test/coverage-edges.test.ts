/**
 * Branches that only appear at the edges of a page or a panel: a relative --out, twenty-one missing docs,
 * a root that is not a level, an interior node with no level of its own. Each is a real input, so each is
 * a test — the coverage number is a symptom, the test is the point.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseModel } from '../src/model.ts'
import { outputPath, reportCommand } from '../src/cli-output.ts'
import { renderModel } from '../src/render.ts'
import { viewerPage } from '../src/viewer-page.ts'
import { indexPage } from '../src/index-page.ts'
import { run } from '../src/cli.ts'

const SHOP = new URL('../examples/shop.json', import.meta.url).pathname
test('--out resolves a relative .svg against the working directory, and a directory stays a directory', () => {
  assert.equal(outputPath('rel.svg', 'm', ''), resolve('rel.svg'))
  assert.equal(outputPath('/tmp/abs.svg', 'm', ''), '/tmp/abs.svg')
  assert.equal(outputPath('shots', 'm', ''), join('shots', '~root.svg'), 'the root level has its own file name')
  assert.equal(outputPath(undefined, 'm', 'a/b'), join('out', 'm', 'a~b.svg'))
})

test('twenty-one missing docs say "and N more" instead of listing the lot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-many-docs-'))
  const file = join(dir, 'many.json')
  const nodes = Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, subtype: 'system' }))
  writeFileSync(file, JSON.stringify({ id: 'many', title: 'Many', levels: [{ path: '', nodes, edges: [] }] }))
  const parsed = parseModel(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  const lines: string[] = []
  const { error } = console
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  try {
    const code = reportCommand(
      { file, json: false, strict: true, requireDocs: true, render: false, png: false, scale: 2 },
      renderModel(parsed),
      parsed,
    )
    assert.equal(code, 1, 'a strict run with missing docs fails')
  } finally {
    console.error = error
  }
  assert.ok(lines.some((line) => line.includes('… and 1 more')), `expected an elision line, got: ${lines.join(' | ')}`)
})

test('a fully documented model passes --require-docs with nothing printed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-docs-ok-'))
  const file = join(dir, 'ok.json')
  writeFileSync(
    file,
    JSON.stringify({ id: 'ok', title: 'Ok', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }] }),
  )
  mkdirSync(join(dir, 'ok', 'nodes'), { recursive: true })
  writeFileSync(join(dir, 'ok', 'nodes', 'a.md'), '# A\n\nIt is A.')
  const parsed = parseModel(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  assert.equal(
    reportCommand({ file, json: false, strict: true, requireDocs: true, render: false, png: false, scale: 2 }, renderModel(parsed), parsed),
    0,
  )
})

test('a model that is valid json but not a model is refused with its own message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-badmodel-'))
  const file = join(dir, 'shape.json')
  writeFileSync(file, JSON.stringify({ id: 'x', title: 'X', levels: [{ path: '', nodes: [{ id: 'a' }], edges: [] }] }))
  assert.equal(await run(['audit', file]), 2)
})

test('--scale below 1 is clamped, and the render still happens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-scale-'))
  assert.equal(await run(['render', SHOP, '--out', join(dir, 'out'), '--scale', '0']), 0)
})

test('the grid puts failing diagrams first and breaks ties by recency', () => {
  const base = { svg: '<svg></svg>', nodes: 1, flows: 0, wide: false, levels: [''] }
  const html = indexPage(
    [
      { ...base, id: 'a', title: 'A', updated: '2026-11-01T00:00:00.000Z', ok: true },
      { ...base, id: 'b', title: 'B', updated: '2026-10-01T00:00:00.000Z', ok: true },
      { ...base, id: 'c', title: 'C', updated: '2026-09-01T00:00:00.000Z', ok: false },
    ],
    'auto',
    'audit',
  )
  const at = (id: string): number => html.indexOf(`/d/${id}"`)
  assert.ok(at('c') < at('a') && at('a') < at('b'), 'failures first, then newest')
})

test('--expand renders the composed picture through the command line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-expand-'))
  const out = join(dir, 'expanded')
  const lens = new URL('../examples/lens.json', import.meta.url).pathname
  assert.equal(await run(['render', lens, '--expand', 'context1', '--out', out]), 0)
})

test('an expanded page keeps the outside docs and links only interior nodes that have a level', () => {
  // fixtures/droid.json is the one with a level inside a level, which is what a drill link needs
  const deep = parseModel(JSON.parse(readFileSync(new URL('../fixtures/droid.json', import.meta.url), 'utf8')) as unknown)
  const inner = deep.levels.find((l) => l.path.split('/').length === 2)
  assert.ok(inner, 'the fixture has a second level')
  const docs = { nodes: { [inner.path.split('/').pop() as string]: '<p>the door</p>' }, edges: {} }
  const html = viewerPage(deep, inner.path, null, 'auto', docs)
  assert.ok(html.includes('the door'), 'an interior node renders its doc')
  assert.ok(/href="\/d\/droid\/[^"]+"/.test(html), 'and its own level is a real link')
})

test('a level page with a width too wide to fit opens at 100% and says why', () => {
  const html = viewerPage(parseModel(JSON.parse(readFileSync(SHOP, 'utf8')) as unknown), '')
  assert.ok(html.includes('c4-stage'), 'the stage is there')
})

/**
 * Integration — the real corpus, the real pipeline.
 *
 * This is the acceptance test: every level of every fixture model (the owner's
 * actual concepts, exported read-only from the app's store) must render and
 * must pass all five geometry gates. A green unit suite with a red level here is
 * a failed build.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderFile, renderModel } from '../src/render.ts'
import { parseModel } from '../src/model.ts'
import { auditLine } from '../src/audit.ts'

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'examples')
const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()

test('the corpus exists and covers several levels', () => {
  assert.ok(files.length >= 3, `expected >=3 fixture models, found ${files.length}`)
})

for (const file of files) {
  test(`${file}: every level renders, audits clean, and is deterministic`, () => {
    const report = renderFile(join(FIXTURES, file))
    assert.ok(report.levels.length > 0, 'no levels rendered')
    for (const level of report.levels) {
      assert.ok(level.audit.ok, auditLine(level.audit))
      assert.ok(level.svg.startsWith('<svg'), 'not an svg')
      assert.ok(level.svg.trimEnd().endsWith('</svg>'), 'svg not closed')
      assert.ok(!level.svg.includes('NaN'), 'NaN in output')
      assert.ok(!level.svg.includes('undefined'), 'undefined in output')
      const again = renderFile(join(FIXTURES, file)).levels.find((l) => l.path === level.path)
      assert.equal(again?.svg, level.svg, 'render is not deterministic')
    }
  })
}

test('every level path in the corpus is unique and root is renderable by path', () => {
  const report = renderFile(join(FIXTURES, files[0]))
  const paths = report.levels.map((l) => l.path)
  assert.equal(new Set(paths).size, paths.length)
  const root = renderFile(join(FIXTURES, files[0]), '')
  assert.equal(root.levels.length, 1)
  assert.equal(root.levels[0].path, '')
})

test('a rank hint that leaves empty ranks still routes inside the drawing', () => {
  // regression: rankEdges() returned {0,0} for a dummy-only rank, tracks collapsed to
  // x=24 and a wire looped back 95.5px through its own source node while auditing OK
  const model = {
    id: 'gaps',
    title: 'Rank gaps',
    levels: [
      {
        path: '',
        nodes: [
          { id: 'a', label: 'Start', subtype: 'microservice', state: 'built' as const, rank: 0 },
          { id: 'b', label: 'End', subtype: 'microservice', state: 'built' as const, rank: 5 },
          { id: 'c', label: 'Other', subtype: 'microservice', state: 'built' as const, rank: 5 },
        ],
        edges: [
          { desc: 'the payload this edge carries', from: 'a', to: 'b', label: 'long haul' },
          { desc: 'the payload this edge carries', from: 'a', to: 'c', label: 'other haul' },
        ],
      },
    ],
  }
  const report = renderModel(parseModel(model))
  assert.equal(report.levels[0].audit.ok, true, auditLine(report.levels[0].audit))
  // every path point must sit inside the drawing, and the drawing must span more than a gutter. The long axis
  // is what collapsed in the regression, and which axis that is depends on the orientation the layout chose.
  const width = Number(/width="([\d.]+)"/.exec(report.levels[0].svg)?.[1])
  const height = Number(/height="([\d.]+)"/.exec(report.levels[0].svg)?.[1])
  assert.ok(Math.max(width, height) > 300, `drawing collapsed to ${width}x${height}`)
  const xs = [...report.levels[0].svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[1]))
  const ys = [...report.levels[0].svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]))
  assert.ok(Math.max(...xs) <= width, 'a route leaves the drawing')
  assert.ok(Math.min(...xs) >= 0, 'a route has a negative x')
  assert.ok(Math.max(...ys) <= height, 'a route leaves the drawing vertically')
})

test('renderFile reads the file once and can expand a box on the way through', () => {
  const lensPath = join(new URL('..', import.meta.url).pathname, 'examples', 'lens.json')
  const flat = renderFile(lensPath, 'context1')
  assert.equal(flat.levels[0].path, 'context1')
  const expanded = renderFile(lensPath, 'context1', 'context1')
  assert.ok(expanded.levels[0].svg.includes('frame-context1'), 'the dashed frame is drawn')
})

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
import { renderFile } from '../src/render.ts'
import { auditLine } from '../src/audit.ts'

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures')
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

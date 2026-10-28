#!/usr/bin/env node
/**
 * Golden check — the guard for every refactor that is not supposed to change the picture.
 *
 *   node tools/golden.mjs --save     # record the current SVG hash of every corpus level
 *   node tools/golden.mjs --check    # re-render and diff; exit 1 on any change
 *
 * A hash change is not automatically wrong (a fixed defect changes the drawing), but it must be
 * deliberate: re-save and say WHY in the commit.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderFile } from '../src/render.ts'

const ROOT = new URL('..', import.meta.url).pathname
const STORE = join(ROOT, 'tools', 'golden.txt')

const models = [
  ...readdirSync(join(ROOT, 'fixtures')).filter((f) => f.endsWith('.json')).map((f) => join('fixtures', f)),
  ...readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json')).map((f) => join('examples', f)),
]

const rows = models.flatMap((file) =>
  renderFile(join(ROOT, file)).levels.map((level) => `${file}#${level.path} ${createHash('sha256').update(level.svg).digest('hex').slice(0, 16)} ${level.audit.ok ? 'ok' : 'FAIL'}`),
)

if (process.argv.includes('--save')) {
  writeFileSync(STORE, `${rows.join('\n')}\n`)
  console.log(`golden saved — ${rows.length} levels → tools/golden.txt`)
} else {
  if (!existsSync(STORE)) {
    console.error('no tools/golden.txt — run with --save first')
    process.exit(2)
  }
  const before = readFileSync(STORE, 'utf8').trim().split('\n')
  const changed = rows.filter((row, i) => row !== before[i])
  const failed = rows.filter((row) => row.endsWith('FAIL'))
  if (changed.length) {
    console.error(`golden CHANGED — ${changed.length} level(s)`)
    for (const row of changed) console.error(`  was: ${before[rows.indexOf(row)] ?? '(missing)'}\n  now: ${row}`)
  }
  if (failed.length) console.error(`audit FAIL on ${failed.length} level(s): ${failed.join(', ')}`)
  if (changed.length || failed.length) process.exit(1)
  console.log(`golden OK — ${rows.length} levels identical`)
}

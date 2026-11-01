#!/usr/bin/env node
/**
 * New-code coverage, at 100% — measured on the LINES THIS BRANCH ADDED, not on the whole file.
 *
 * The repo floor in `check.sh` is 95% aggregate: old code has old gaps, and pretending otherwise would mean
 * either deleting tests or lowering the number. New code gets no such allowance — every line and branch a
 * change adds is expected to be exercised in the same commit. The old code it sits next to is not this
 * script's business, which is why the diff decides what "new" means.
 *
 *   node tools/coverage-new.mjs [--base main] [--report coverage/lcov.info]
 *
 * Run the tests with lcov output first; `check.sh` does both, in that order.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const GIT = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'].find((p) => existsSync(p)) ?? '/usr/bin/git'

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}

/**
 * A branch that cannot be reached is marked IN THE SOURCE, on the line itself:
 *
 *   const x = f() ?? fallback   // coverage:invariant — parseModel always fills f()
 *
 * Line numbers in a separate list rot the moment anyone edits above them; a marker travels with its line and
 * is read by whoever touches the code. The tool prints every exemption it honours, so none can hide.
 */
const MARKER = 'coverage:invariant'

const base = arg('base', 'main')
const lcovPath = join(ROOT, arg('report', 'coverage/lcov.info'))
if (!existsSync(lcovPath)) {
  console.error(`no lcov at ${lcovPath} — run the tests with --test-reporter=lcov first`)
  process.exit(2)
}

const git = (args) => execFileSync(GIT, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

/** Added line numbers per file, from a zero-context diff. Hunks are `@@ -old +new,count @@`. */
function addedLines() {
  let diff
  try {
    diff = git(['diff', '-U0', '--diff-filter=ACMR', `${base}...HEAD`, '--', 'src'])
  } catch {
    diff = git(['diff', '-U0', '--diff-filter=ACMR', 'HEAD', '--', 'src']) // no base branch available
  }
  const out = new Map()
  let file = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6)
      if (!out.has(file)) out.set(file, new Set())
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk && file) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      for (let i = 0; i < count; i += 1) out.get(file).add(start + i)
    }
  }
  return out
}

/** lcov → per-file hits, keyed the way git names the file. */
function coverage() {
  const files = new Map()
  let current = null
  for (const line of readFileSync(lcovPath, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      current = { lines: new Map(), branches: new Map() }
      files.set(line.slice(3).replace(`${ROOT}/`, ''), current)
      continue
    }
    if (!current) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const tag = line.slice(0, colon)
    const rest = line.slice(colon + 1)
    if (tag === 'DA') {
      const [number, hits] = rest.split(',').map(Number)
      current.lines.set(number, hits)
    }
    if (tag === 'BRDA') {
      const [number, , , taken] = rest.split(',')
      const before = current.branches.get(Number(number)) ?? { total: 0, hit: 0 }
      before.total += 1
      if (taken !== '-' && Number(taken) > 0) before.hit += 1
      current.branches.set(Number(number), before)
    }
  }
  return files
}

const added = addedLines()
const reported = coverage()
if (!added.size) {
  console.log('new code: nothing added under src/ — nothing to require')
  process.exit(0)
}

let bad = 0
let checked = 0
for (const [file, lines] of added) {
  const entry = reported.get(file)
  if (!entry) {
    console.log(`  FAIL ${file}: no coverage recorded — nothing imports it`)
    bad += 1
    continue
  }
  checked += 1
  // a line the diff mentions but lcov does not know would mean the file shrank since: it no longer exists
  const missingLines = [...lines].filter((number) => entry.lines.has(number) && !(entry.lines.get(number) > 0))
  const source = readFileSync(join(ROOT, file), 'utf8').split('\n')
  // V8 books some branches on the statement ABOVE the one that carries them, so a marker excuses its own
  // line and the line below it — never the line above, which would swallow a neighbour
  const near = (number) => [source[number - 2], source[number - 1], source[number]].some((line) => (line ?? '').includes(MARKER))
  const excused = new Set([...lines].filter((number) => near(number)))
  const missingBranches = [...lines].filter((number) => {
    const branch = entry.branches.get(number)
    return branch && branch.hit < branch.total && !excused.has(number)
  })
  for (const number of excused) {
    const own = source[number - 1] ?? ''
    if (!own.includes(MARKER)) continue // the neighbour, already reported by its own line
    console.log(`       excused ${file}:${number} — ${own.split(MARKER)[1]?.replace(/^\s*—\s*/, '').trim() ?? MARKER}`)
  }
  const ok = !missingLines.length && !missingBranches.length
  if (!ok) bad += 1
  const detail = [
    missingLines.length ? `uncovered lines ${missingLines.slice(0, 8).join(', ')}` : '',
    missingBranches.length ? `uncovered branches on ${missingBranches.slice(0, 8).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${file}: ${lines.size} new line(s)${detail ? ` — ${detail}` : ''}`)
}
console.log(`\nnew code: ${checked} file(s) checked, ${bad} below 100%`)
process.exit(bad ? 1 : 0)

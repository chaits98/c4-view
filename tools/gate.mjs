#!/usr/bin/env node
/**
 * The repo's static gate. SonarQube reads smells; this reads the rules Sonar
 * cannot: the 300-line ceiling, the purity boundary, and the bans that keep a
 * subagent from leaving debris in a shared tree.
 *
 *   node tools/gate.mjs
 *
 * Exit 1 with one line per violation, `file:line rule message`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const MAX_LINES = 300
const violations = []

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (name === 'node_modules' || name === 'out' || name.startsWith('.')) return []
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

const rel = (p) => relative(ROOT, p)

function check(file) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const name = rel(file)
  const isSrc = name.startsWith('src/')
  const isPure = /^src\/(layout|svg)\//.test(name)

  if (lines.length - (src.endsWith('\n') ? 1 : 0) > MAX_LINES) {
    violations.push(`${name}:0 lines file exceeds ${MAX_LINES} lines (${lines.length - 1})`)
  }
  lines.forEach((line, i) => {
    const at = `${name}:${i + 1}`
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) violations.push(`${at} placeholder "${line.trim().slice(0, 60)}"`)
    if (/\bas any\b|:\s*any\b|<any>/.test(line)) violations.push(`${at} no-any "${line.trim().slice(0, 60)}"`)
    if (isPure && /from '(node:|\.\.\/?(cli|server|render|png))/.test(line)) {
      violations.push(`${at} purity layouts/svg must not import runtime modules`)
    }
    if ((isPure || /^src\/(model|audit|metrics)\.ts$/.test(name)) && /\bconsole\.(log|warn|info|debug)\b/.test(line)) {
      violations.push(`${at} no-console a library file must not log`)
    }
  })
}

for (const file of walk(join(ROOT, 'src')).filter((f) => f.endsWith('.ts'))) check(file)
for (const file of walk(join(ROOT, 'test')).filter((f) => f.endsWith('.ts'))) check(file)
for (const file of walk(join(ROOT, 'scripts')).filter((f) => f.endsWith('.ts'))) check(file)
// the browser script and the tooling obey the same ceiling — a viewer is not exempt from 300 lines
for (const file of walk(join(ROOT, 'public')).filter((f) => f.endsWith('.js'))) check(file)
// the gate carries the banned patterns as its own rules: measure it, do not read it for violations
for (const file of walk(join(ROOT, 'tools')).filter((f) => f.endsWith('.mjs') && !f.endsWith('gate.mjs'))) check(file)

// every test file must actually contain a test
for (const file of walk(join(ROOT, 'test')).filter((f) => f.endsWith('.test.ts'))) {
  if (!/\btest\(/.test(readFileSync(file, 'utf8'))) violations.push(`${rel(file)}:0 empty-test file declares no test()`)
}

// the corpus the audit runs against must exist
const fixtures = existsSync(join(ROOT, 'fixtures')) ? readdirSync(join(ROOT, 'fixtures')).filter((f) => f.endsWith('.json')) : []
if (fixtures.length < 3) violations.push(`fixtures:0 corpus missing — expected >=3 exported models, found ${fixtures.length}`)

if (violations.length) {
  console.error(`gate FAILED — ${violations.length} violation(s)`)
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log(`gate OK — ${fixtures.length} fixtures, ${MAX_LINES}-line ceiling, purity + no-any + no-placeholder clean`)

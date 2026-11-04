/**
 * The security report follows the version, mechanically.
 *
 * The failure this guards against is silent: a version ships with a report that still describes the previous
 * one, and nothing on the surface says so. Two facts are enough — the report is written by `npm version`, and
 * the version in the report is the version in the package.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'))
const report = readFileSync(`${ROOT}docs/security/REPORT.md`, 'utf8')

test('npm version regenerates the report before it commits and tags', () => {
  assert.match(pkg.scripts.version ?? '', /security-report\.mjs/, 'the version lifecycle script writes the report')
  assert.match(pkg.scripts['report:security'] ?? '', /security-report\.mjs/, 'and it can be run on demand')
})

test('the report carries a section for the version in package.json', () => {
  const sections = report.match(/^## Re-run at (\d+\.\d+\.\d+) — /gm) ?? []
  assert.ok(sections.length > 0, 'at least one section')
  assert.ok(
    sections.some((line) => line.includes(`at ${pkg.version} `)),
    `docs/security/REPORT.md has no section for ${pkg.version} — run npm run report:security`,
  )
})

test('one section per version: regenerating replaces, never stacks', () => {
  const versions = [...report.matchAll(/^## Re-run at (\d+\.\d+\.\d+) — /gm)].map((m) => m[1])
  assert.equal(new Set(versions).size, versions.length, 'no version is documented twice')
})

/**
 * The install contract, asserted. These four failures all shipped at least once:
 * `bin` pointing at a file that does not exist, `files` omitting the viewer assets, an
 * entry that tries to run TypeScript from `node_modules` (Node refuses), and no engine floor.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  bin: Record<string, string>
  files: string[]
  engines: { node: string }
  scripts: Record<string, string>
  private: boolean
}

test('the bin entry exists and is plain JavaScript', () => {
  const bin = pkg.bin.c4v
  assert.ok(bin, 'package.json has no c4v bin')
  assert.ok(existsSync(join(ROOT, bin)), `${bin} does not exist`)
  assert.ok(bin.endsWith('.mjs') || bin.endsWith('.js'), 'the entry must be JS: node cannot strip types under node_modules')
})

test('the entry prefers the compiled build when one exists', () => {
  const source = readFileSync(join(ROOT, pkg.bin.c4v), 'utf8')
  assert.match(source, /'dist',\s*'cli\.js'/, 'the launcher must look for dist/cli.js')
  assert.match(source, /'src',\s*'cli\.ts'/, 'the launcher must fall back to the source checkout')
})

test('the published file list carries everything an install needs to render', () => {
  for (const need of ['bin/', 'dist/', 'public/', 'data/']) {
    assert.ok(pkg.files.includes(need), `files[] is missing ${need}`)
  }
})

test('there is a build script and an engine floor', () => {
  assert.ok(pkg.scripts.build, 'no build script — a tarball would ship TypeScript under node_modules')
  assert.match(pkg.engines.node, /18|2[0-9]/, `engines.node is ${pkg.engines.node}`)
})

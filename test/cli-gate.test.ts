/**
 * The `c4v gate …` verbs, driven as a user would: each one runs in a throwaway repo and prints what the
 * hook or the human would see. The point is the contract — install writes two things, check reads the
 * index, defer records one line, uninstall leaves the record behind.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateCommand } from '../src/cli-gate.ts'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' })

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'c4v-cli-gate-'))
  git(root, 'init', '-q', '.')
  mkdirSync(join(root, 'docs/c4'), { recursive: true })
  writeFileSync(join(root, 'docs/c4/shop.json'), JSON.stringify({ id: 'shop', title: 'Shop', levels: [] }))
  writeFileSync(join(root, 'app.js'), '// v1\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'base')
  return root
}

/** Run a gate verb inside `root`, capturing what it printed. */
function run(root: string, argv: string[]): { code: number; out: string } {
  const previous = process.cwd()
  const lines: string[] = []
  const { log, error } = console
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  try {
    process.chdir(root)
    const code = gateCommand(argv)
    return { code, out: lines.join('\n') }
  } finally {
    console.log = log
    console.error = error
    process.chdir(previous)
  }
}

test('install prints every file it writes, and status confirms both', () => {
  const root = repo()
  const installed = run(root, ['gate', 'install'])
  assert.equal(installed.code, 0)
  assert.match(installed.out, /wrote \.githooks\/pre-commit/)
  assert.match(installed.out, /core\.hooksPath = \.githooks/)
  const status = run(root, ['gate', 'status'])
  assert.match(status.out, /core\.hooksPath: \.githooks ✓/)
  assert.match(status.out, /models:         1/)
})

test('check refuses what the hook refuses, and passes once the diagram moves', () => {
  const root = repo()
  writeFileSync(join(root, 'app.js'), '// v2\n')
  git(root, 'add', 'app.js')
  assert.equal(run(root, ['gate', 'check', '--staged']).code, 1)
  writeFileSync(join(root, 'docs/c4/shop.json'), JSON.stringify({ id: 'shop', title: 'Shop v2', levels: [] }))
  git(root, 'add', 'docs/c4/shop.json')
  assert.equal(run(root, ['gate', 'check', '--staged']).code, 0)
})

test('defer records a line, check honours it, report shows it', () => {
  const root = repo()
  writeFileSync(join(root, 'app.js'), '// v2\n')
  git(root, 'add', 'app.js')
  const deferred = run(root, ['gate', 'defer', '--reason', 'rename only, no topology change'])
  assert.equal(deferred.code, 0)
  assert.match(deferred.out, /deferred ✓/)
  assert.equal(run(root, ['gate', 'check', '--staged']).code, 0)
  const report = run(root, ['gate', 'report'])
  assert.match(report.out, /rename only, no topology change/)
  assert.match(report.out, /1 deferral\(s\) total/)
})

test('defer without a reason is refused, with the reason why', () => {
  const root = repo()
  writeFileSync(join(root, 'app.js'), '// v2\n')
  git(root, 'add', 'app.js')
  const bad = run(root, ['gate', 'defer'])
  assert.equal(bad.code, 2)
  assert.match(bad.out, /needs a reason/)
})

test('check without --staged explains itself instead of guessing', () => {
  const root = repo()
  const bare = run(root, ['gate', 'check'])
  assert.equal(bare.code, 2)
  assert.match(bare.out, /--staged/)
})

test('report on a clean repo says so, and uninstall removes only the hook', () => {
  const root = repo()
  assert.match(run(root, ['gate', 'report']).out, /no deferrals/)
  run(root, ['gate', 'install'])
  const removed = run(root, ['gate', 'uninstall'])
  assert.equal(removed.code, 0)
  assert.match(removed.out, /removed \.githooks\/pre-commit/)
  assert.match(removed.out, /left alone: docs\/c4\/\.gate-log\.jsonl/)
})

test('an unknown action prints the usage, and a non-repo says why it cannot help', () => {
  const root = repo()
  const bad = run(root, ['gate', 'explode'])
  assert.equal(bad.code, 2)
  assert.match(bad.out, /unknown gate action/)
  const nowhere = mkdtempSync(join(tmpdir(), 'c4v-not-a-repo-'))
  const outside = run(nowhere, ['gate', 'status'])
  assert.equal(outside.code, 2)
  assert.match(outside.out, /not inside a git repository/)
})

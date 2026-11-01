/**
 * The repo gate, tested against real throwaway git repositories: the interesting behaviour is all about
 * what git has staged, and a mock of `git diff --cached` would only test the mock.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deferGate, deferrals, installGate, models, repoRoot, staged, statusGate, uninstallGate, verdict } from '../src/gate.ts'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' })

/** A repo with one model and its docs, committed, and a clean index. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'c4v-gate-'))
  git(root, 'init', '-q', '.')
  mkdirSync(join(root, 'docs/c4'), { recursive: true })
  writeFileSync(join(root, 'docs/c4/shop.json'), JSON.stringify({ id: 'shop', title: 'Shop', levels: [] }))
  writeFileSync(join(root, 'app.js'), '// v1\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'base')
  return root
}

const stage = (root: string, file: string, body: string): void => {
  writeFileSync(join(root, file), body)
  git(root, 'add', file)
}

test('a repo with no diagrams has nothing to keep in sync', () => {
  const root = mkdtempSync(join(tmpdir(), 'c4v-gate-'))
  git(root, 'init', '-q', '.')
  writeFileSync(join(root, 'a.js'), 'x')
  git(root, 'add', '-A')
  assert.deepEqual(verdict(root), { ok: true, lines: ['gate: no diagrams in this repo yet — nothing to keep in sync'] })
})

test('a staged commit that touches docs/c4 passes', () => {
  const root = repo()
  stage(root, 'docs/c4/shop.json', JSON.stringify({ id: 'shop', title: 'Shop v2', levels: [] }))
  const result = verdict(root)
  assert.equal(result.ok, true)
  assert.match(result.lines[0], /updates docs\/c4/)
})

test('code without the diagram fails, and names the command that fixes it', () => {
  const root = repo()
  stage(root, 'app.js', '// v2\n')
  const result = verdict(root)
  assert.equal(result.ok, false)
  assert.match(result.lines[0], /none under docs\/c4/)
  assert.ok(result.lines.some((line) => line.includes('c4v gate defer --reason')))
})

test('a deferral covers the diff it was made against, and only that diff', () => {
  const root = repo()
  stage(root, 'app.js', '// v2\n')
  const entry = deferGate(root, 'rename only, no topology change')
  assert.equal(verdict(root).ok, true)
  assert.match(verdict(root).lines[0], /deferred ✓/)

  stage(root, 'app.js', '// v2\n// more\n')
  const stale = verdict(root)
  assert.equal(stale.ok, false, 'a new edit is a new decision')
  assert.match(stale.lines[0], /none under docs\/c4/)
  assert.equal(deferrals(root).length, 1, 'the old record is kept, not overwritten')
  assert.equal(deferrals(root)[0].diff, entry.diff)
})

test('a deferral goes stale when the model moves under it', () => {
  const root = repo()
  stage(root, 'app.js', '// v2\n')
  deferGate(root, 'no model change needed')
  stage(root, 'docs/c4/shop.json', JSON.stringify({ id: 'shop', title: 'Shop v3', levels: [] }))
  git(root, 'commit', '-qm', 'model')
  // a fresh code change, whose deferral would be against the new model
  stage(root, 'app.js', '// v3\n')
  const first = deferGate(root, 'still no model change')
  assert.equal(verdict(root).ok, true)
  // now the model moves without the code, then the code moves back: the old record must not match
  stage(root, 'docs/c4/shop.json', JSON.stringify({ id: 'shop', title: 'Shop v4', levels: [] }))
  git(root, 'commit', '-qm', 'model again')
  stage(root, 'app.js', '// v4\n')
  assert.equal(verdict(root).ok, false)
  assert.equal(first.model['docs/c4/shop.json'] === models(root)['docs/c4/shop.json'], false)
})

test('a deferral needs a reason a reviewer could check', () => {
  const root = repo()
  stage(root, 'app.js', '// v2\n')
  assert.throws(() => deferGate(root, '   '), /needs a reason/)
  assert.throws(() => deferGate(root, ''), /needs a reason/)
})

test('deferring with nothing staged is refused', () => {
  const root = repo()
  assert.throws(() => deferGate(root, 'nothing to defer'), /nothing is staged/)
})

test('install writes a hook that chains an existing one, and points hooksPath at it', () => {
  const root = repo()
  const lines = installGate(root)
  const hook = readFileSync(join(root, '.githooks/pre-commit'), 'utf8')
  assert.match(hook, /exec c4v gate check --staged/)
  assert.equal(git(root, 'config', '--get', 'core.hooksPath').trim(), '.githooks')
  assert.ok(lines.some((line) => line.includes('core.hooksPath = .githooks')))
})

test('status tells the truth about what is installed, and uninstall leaves the log', () => {
  const root = repo()
  assert.ok(statusGate(root).some((line) => line.includes('not installed')))
  installGate(root)
  assert.ok(statusGate(root).some((line) => line.includes('core.hooksPath: .githooks ✓')))
  stage(root, 'app.js', '// v2\n')
  deferGate(root, 'kept for review')
  uninstallGate(root)
  assert.equal(existsSync(join(root, '.githooks/pre-commit')), false)
  // `git config --get` exits 1 when the key is gone, which is exactly what "unset" looks like
  let hooksPath = ''
  try {
    hooksPath = git(root, 'config', '--get', 'core.hooksPath').trim()
  } catch {
    hooksPath = ''
  }
  assert.equal(hooksPath, '', 'hooksPath is unset again')
  assert.equal(deferrals(root).length, 1, 'the deferral record stays: it is history, not configuration')
})

test('staged() reports the files and a diff hash that changes with content', () => {
  const root = repo()
  stage(root, 'app.js', '// v2\n')
  const first = staged(root)
  assert.deepEqual(first.files, ['app.js'])
  stage(root, 'app.js', '// v3\n')
  assert.notEqual(staged(root).diff, first.diff)
})

test('repoRoot refuses a directory that is not a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-nogit-'))
  assert.throws(() => repoRoot(dir), /not inside a git repository/)
})

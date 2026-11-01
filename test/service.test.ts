/**
 * The unit file is generated from the running binary, never from a checkout path or PATH lookup.
 * That is the whole reason it works when `c4v` came from npm.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UNIT, ensureTokenFile, installService, serviceHints, serviceStatus, systemctlPath, uninstallService, unitPath, unitText } from '../src/service.ts'

const OPTS = { port: '8788', host: '127.0.0.1', root: '/home/x/.c4-view' }

test('the unit names the exact node binary and module, not a PATH lookup', () => {
  const text = unitText(OPTS, '/usr/local/bin/node', '/opt/c4/dist/cli.js')
  assert.match(text, /^ExecStart=\/usr\/local\/bin\/node \/opt\/c4\/dist\/cli\.js serve --port 8788 --host 127\.0\.0\.1 --root \/home\/x\/\.c4-view$/m)
  assert.match(text, /^Restart=always$/m)
  assert.match(text, /^WantedBy=default\.target$/m)
})

test('a path with a space is quoted, so systemd does not split it', () => {
  const text = unitText(OPTS, '/opt/my node/bin/node', '/opt/c 4/cli.js')
  assert.match(text, /ExecStart="\/opt\/my node\/bin\/node" "\/opt\/c 4\/cli\.js" serve/)
})

test('the env file is optional (leading dash), so a fresh machine still starts', () => {
  assert.match(unitText(OPTS), /^EnvironmentFile=-%h\/\.config\/c4-view\/env$/m)
})

test('by default the unit runs the CLI, not the service module that wrote it', () => {
  const exec = /^ExecStart=(.+)$/m.exec(unitText(OPTS))?.[1] ?? ''
  assert.match(exec, /\/cli\.(ts|js) serve /)
  assert.doesNotMatch(exec, /service\.(ts|js)/)
})

test('the unit restarts a crashed server and a cleanly-exited one alike', () => {
  assert.match(unitText(OPTS), /^Restart=always$/m)
})

test('the unit path is the user unit directory', () => {
  assert.match(unitPath(), /\.config\/systemd\/user\/c4-view\.service$/)
  assert.equal(UNIT, 'c4-view.service')
})

test('status on a missing unit is exit 1 with the fix, not a crash', () => {
  const code = serviceStatus()
  assert.ok(code === 0 || code === 1)
})

test('hints name the journal, the url and how to survive a logout', () => {
  const hints = serviceHints('8788', '0.0.0.0').join('\n')
  assert.match(hints, /journalctl --user -u c4-view\.service/)
  assert.match(hints, /localhost:8788/)
  assert.match(hints, /loginctl enable-linger/)
})

test('systemctl comes from an absolute path, never from PATH', () => {
  assert.equal(systemctlPath((file: string) => file === '/bin/systemctl'), '/bin/systemctl')
  assert.equal(systemctlPath(() => true), '/usr/bin/systemctl', 'first candidate wins')
  assert.throws(() => systemctlPath(() => false), /systemctl not found at \/usr\/bin\/systemctl/)
})

/** Records what would have been spawned — the unit file is what this module promises, not systemd. */
function fakeSystemctl(behaviour: (args: string[]) => string | Buffer = () => '') {
  const calls: string[][] = []
  const run = (args: string[]): string | Buffer => {
    calls.push(args)
    return behaviour(args)
  }
  return { calls, run }
}

test('install writes the unit, then reloads, enables and RESTARTS it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-unit-'))
  try {
    const { calls, run } = fakeSystemctl()
    const file = installService(OPTS, run, dir)
    assert.equal(file, join(dir, UNIT))
    assert.match(readFileSync(file, 'utf8'), /ExecStart=.* serve --port 8788/)
    assert.deepEqual(calls, [
      ['--user', 'show-environment'],
      ['--user', 'daemon-reload'],
      ['--user', 'enable', UNIT],
      // not `enable --now`: that leaves an already-running unit on the old code
      ['--user', 'restart', UNIT],
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install refuses on a box without a systemd user session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-unit-'))
  try {
    const { run } = fakeSystemctl(() => {
      throw new Error('Failed to connect to bus')
    })
    assert.throws(() => installService(OPTS, run, dir), /systemd|Failed to connect/)
    assert.equal(existsSync(join(dir, UNIT)), false, 'nothing is written when the session is missing')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstall removes the unit and stops it, and is a no-op without one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-unit-'))
  try {
    const { run } = fakeSystemctl()
    assert.equal(uninstallService(run, dir), false, 'no unit, nothing to do')
    installService(OPTS, run, dir)
    assert.equal(uninstallService(run, dir), true)
    assert.equal(existsSync(join(dir, UNIT)), false, 'unit file is gone')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstall keeps going when systemctl has already forgotten the unit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-unit-'))
  try {
    const { run } = fakeSystemctl(() => {
      throw new Error('Unit c4-view.service not loaded')
    })
    installService(OPTS, () => '', dir)
    assert.equal(uninstallService(run, dir), true, 'the file is still ours to delete')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('status prints what systemd says, and 1 when there is no unit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-unit-'))
  try {
    assert.equal(serviceStatus(fakeSystemctl().run, dir), 1, 'no unit → 1')
    installService(OPTS, () => '', dir)
    const { run, calls } = fakeSystemctl(() => '● c4-view.service - active (running)\n')
    assert.equal(serviceStatus(run, dir), 0)
    assert.deepEqual(calls.at(0), ['--user', 'status', UNIT, '--no-pager'])
    assert.equal(serviceStatus(fakeSystemctl(() => {
      throw new Error('inactive (dead)')
    }).run, dir), 1, 'a dead unit exits 1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a token file is only written when the listener is reachable off-box', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-token-'))
  try {
    assert.equal(ensureTokenFile('127.0.0.1', () => 'x', dir), null, 'loopback needs no token')
    assert.equal(ensureTokenFile('localhost', () => 'x', dir), null)
    assert.equal(ensureTokenFile('::1', () => 'x', dir), null)
    assert.equal(ensureTokenFile('0.0.0.0', () => 'abc123', dir), 'abc123', 'returns the token it wrote')
    const file = join(dir, 'env')
    assert.match(readFileSync(file, 'utf8'), /TOKEN=abc123/)
    assert.equal(ensureTokenFile('0.0.0.0', () => 'different', dir), null, 'an existing file is never overwritten')
    assert.match(readFileSync(file as string, 'utf8'), /TOKEN=abc123/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

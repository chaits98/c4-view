/**
 * The unit file is generated from the running binary, never from a checkout path or PATH lookup.
 * That is the whole reason it works when `c4v` came from npm.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UNIT, unitPath, unitText, serviceStatus, serviceHints } from '../src/service.ts'

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

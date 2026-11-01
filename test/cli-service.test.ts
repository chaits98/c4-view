/**
 * `c4v service install` — the one command that writes outside the store and calls systemd.
 *
 * It is tested with both of those injected: a temp home for the unit file and the token file, and a
 * recorded systemctl. What is being proved is the sequence and the messages, not this machine's
 * systemd.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, serviceCommand } from '../src/cli.ts'
import type { Systemctl } from '../src/service.ts'

type Args = Parameters<typeof serviceCommand>[0]

/** The real parser, so the flags are read exactly as the CLI reads them. */
const argsOf = (...argv: string[]): Args => parseArgs(argv)

/** Records the systemctl calls instead of making them. */
function recorder(): { calls: string[][]; run: Systemctl } {
  const calls: string[][] = []
  return { calls, run: (args: string[]) => { calls.push(args); return '' } }
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log
  const err = console.error
  console.log = () => {}
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.log = log
    console.error = err
  }
}

test('install writes a unit and an env file into the given home, then starts it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'c4v-home-'))
  const { calls, run } = recorder()
  try {
    const code = await quiet(() => serviceCommand(argsOf('service', 'install', '--port', '9000', '--host', '0.0.0.0'), { home, run }))
    assert.equal(code, 0)
    const unit = join(home, '.config', 'systemd', 'user', 'c4-view.service')
    assert.ok(existsSync(unit), 'the unit was written under the injected home')
    assert.match(readFileSync(unit, 'utf8'), /--port 9000 --host 0\.0\.0\.0/, 'and it names the port and host')
    const env = join(home, '.config', 'c4-view', 'env')
    assert.ok(existsSync(env), 'a shared host gets a token file')
    assert.match(readFileSync(env, 'utf8'), /C4_VIEW_TOKEN=/, 'with a generated token in it')
    assert.deepEqual(calls.at(-1)?.slice(1), ['restart', 'c4-view.service'], 'and the last verb is restart')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('install on loopback writes no token file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'c4v-home-'))
  const { run } = recorder()
  try {
    assert.equal(await quiet(() => serviceCommand(argsOf('service', 'install'), { home, run })), 0)
    assert.equal(existsSync(join(home, '.config', 'c4-view', 'env')), false, 'nothing to protect on 127.0.0.1')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a systemd that refuses the unit is reported, not swallowed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'c4v-home-'))
  const failing: Systemctl = () => {
    throw new Error('Failed to connect to bus: No such file or directory')
  }
  try {
    assert.equal(await quiet(() => serviceCommand(argsOf('service', 'install'), { home, run: failing })), 1, 'exit 1, not a stack trace')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('uninstall and status answer for a home with no unit', async () => {
  const home = mkdtempSync(join(tmpdir(), 'c4v-home-'))
  const { run } = recorder()
  try {
    assert.equal(await quiet(() => serviceCommand(argsOf('service', 'uninstall'), { home, run })), 0, 'nothing installed is not an error')
    const code = await quiet(() => serviceCommand(argsOf('service', 'status'), { home, run }))
    assert.equal(code, 1, 'status of a missing unit is 1, with the fix printed')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an unknown service action says what the actions are', async () => {
  const home = mkdtempSync(join(tmpdir(), 'c4v-home-'))
  try {
    const code = await quiet(() => serviceCommand(argsOf('service', 'restart'), { home, run: recorder().run }))
    assert.equal(code, 2, 'a verb that does not exist is a usage error')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

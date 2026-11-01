/**
 * `c4v serve` as a process: the one path a unit test cannot reach in-process, because the command
 * owns the event loop until it is signalled. Spawned, asked for /health, then stopped the way a
 * supervisor stops it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Start the CLI and resolve once its output shows it is serving. */
async function boot(port: number, root: string): Promise<{ child: ReturnType<typeof spawn>; output: () => string }> {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', String(port), '--root', root, '--no-token'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let text = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { text += chunk })
  child.stderr?.on('data', (chunk: string) => { text += chunk })
  for (let i = 0; i < 60; i += 1) {
    if (text.includes('local only')) return { child, output: () => text }
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error(`serve never reported listening:\n${text}`)
}

test('serve boots, announces itself, answers /health, and exits on SIGTERM', async () => {
  const root = mkdtempSync(join(tmpdir(), 'c4v-serve-'))
  const port = 8901 + Math.floor(Math.random() * 80)
  const { child, output } = await boot(port, root)
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(health.status, 200)
    assert.equal(((await health.json()) as { ok: boolean }).ok, true)
    assert.match(output(), /serving http:\/\/127\.0\.0\.1:/, 'the notice names the link to open')
    assert.match(output(), /diagrams in /, 'and the store it is reading')
  } finally {
    child.kill('SIGTERM')
    await new Promise<void>((done) => child.once('exit', () => done()))
  }
  rmSync(root, { recursive: true, force: true })
})

test('--no-token off loopback is refused before anything binds', async () => {
  const child = spawn(process.execPath, [CLI, 'serve', '--host', '0.0.0.0', '--no-token', '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { err += chunk })
  const code = await new Promise<number | null>((done) => child.once('exit', (c) => done(c)))
  assert.equal(code, 2, 'it exits 2, the "unusable invocation" code')
  assert.match(err, /only allowed on loopback/)
})

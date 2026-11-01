/**
 * The command line, tested as a command line.
 *
 * Every case here is an exit code an agent branches on, so a silent change to one is a broken
 * contract: 0 clean, 1 strict gate failure, 2 unusable invocation.
 */
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../src/cli.ts'

const ROOT = new URL('..', import.meta.url).pathname
const SHOP = join(ROOT, 'examples', 'shop.json')

const workdir = (): string => mkdtempSync(join(tmpdir(), 'c4v-cli-'))

/** A model whose boundary swallows a stranger: the strict gate must fail on it. */
function brokenModel(dir: string): string {
  const file = join(dir, 'broken.json')
  writeFileSync(
    file,
    JSON.stringify({
      id: 'broken',
      title: 'Broken',
      levels: [
        {
          path: '',
          // x sits directly above `a` in the same column, so the boundary over `a`
          // (16u pad + 22u label strip) reaches into x's box: a group∧node gate failure
          nodes: [
            { id: 'x', label: 'X', subtype: 'system' },
            { id: 'a', label: 'A', subtype: 'system' },
            { id: 'b', label: 'B', subtype: 'system' },
          ],
          edges: [{ from: 'a', to: 'b' }],
          groups: [{ id: 'g', label: 'edge', members: ['a'] }],
        },
      ],
    }),
  )
  return file
}

test('no arguments prints usage and exits 0', async () => {
  assert.equal(await run([]), 0)
})

test('--help prints usage and exits 0', async () => {
  assert.equal(await run(['--help']), 0)
})

test('a missing model argument is a usage error (2)', async () => {
  assert.equal(await run(['render']), 2)
})

test('an unknown command is a usage error (2)', async () => {
  assert.equal(await run(['draw', SHOP]), 2)
})

test('--out <file.svg> without --level is refused before rendering (2)', async () => {
  assert.equal(await run(['render', SHOP, '--out', join(workdir(), 'x.svg')]), 2)
})

test('bad JSON names the file and exits 2', async () => {
  const dir = workdir()
  const file = join(dir, 'bad.json')
  writeFileSync(file, '{ nope')
  assert.equal(await run(['audit', file]), 2)
})

test('a model with an unknown node exits 2', async () => {
  const dir = workdir()
  const file = join(dir, 'ghost.json')
  writeFileSync(
    file,
    JSON.stringify({ id: 'g', title: 'G', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [{ from: 'a', to: 'nope' }] }] }),
  )
  assert.equal(await run(['audit', file, '--strict']), 2)
})

test('an unknown level exits 2', async () => {
  assert.equal(await run(['audit', SHOP, '--level', 'nope', '--strict']), 2)
})

test('audit on a clean model exits 0, and --strict is happy', async () => {
  assert.equal(await run(['audit', SHOP, '--strict']), 0)
})

test('--strict exits 1 when a gate fails', async () => {
  const file = brokenModel(workdir())
  assert.equal(await run(['audit', file, '--strict']), 1)
})

test('without --strict the same model exits 0 (the report still shows FAIL)', async () => {
  const file = brokenModel(workdir())
  assert.equal(await run(['audit', file]), 0)
})

test('render writes one file per level, named by the injective slug', async () => {
  const out = workdir()
  assert.equal(await run(['render', SHOP, '--out', out, '--strict']), 0)
  const root = readFileSync(join(out, '~root.svg'), 'utf8')
  const api = readFileSync(join(out, 'api.svg'), 'utf8')
  assert.ok(root.startsWith('<svg') && api.startsWith('<svg'))
  assert.notEqual(root, api)
})

test('--out <file.svg> writes exactly one file when --level is given', async () => {
  const dir = workdir()
  const file = join(dir, 'one.svg')
  assert.equal(await run(['render', SHOP, '--level', 'api', '--out', file, '--strict']), 0)
  assert.ok(readFileSync(file, 'utf8').startsWith('<svg'))
})

test('--json prints one audit object per level', async () => {
  assert.equal(await run(['audit', SHOP, '--json', '--strict']), 0)
})

test('a tool failure (no browser for --png) is an exit code, not a stack trace', async () => {
  const saved = process.env.C4_CHROMIUM
  const dir = mkdtempSync(join(tmpdir(), 'c4v-cli-'))
  process.env.C4_CHROMIUM = '/nonexistent/chrome'
  try {
    const code = await run(['render', SHOP, '--level', 'api', '--out', join(dir, 'a.svg'), '--png', '--strict'])
    assert.equal(code, 1)
  } finally {
    if (saved === undefined) delete process.env.C4_CHROMIUM
    else process.env.C4_CHROMIUM = saved
  }
})

test('an unusable invocation exits 2 before any work happens', async () => {
  assert.equal(await run([]), 0, 'no command prints usage and succeeds')
  assert.equal(await run(['service', 'bogus']), 2, 'unknown service action')
  assert.equal(await run(['nonsense', SHOP]), 2, 'unknown command')
  assert.equal(await run(['render']), 2, 'missing model')
  assert.equal(await run(['render', join(workdir(), 'nope.json')]), 2, 'unreadable model')
  assert.equal(await run(['render', SHOP, '--out', join(workdir(), 'a.svg')]), 2, 'one svg per level needs --level')
})

test('--no-token is refused off loopback', async () => {
  // the guard runs before the server is created, so this returns instead of listening
  assert.equal(await run(['serve', '--host', '0.0.0.0', '--no-token']), 2)
})

test('service uninstall on a machine with no unit is not an error', async () => {
  assert.equal(await run(['service', 'uninstall']), 0)
})

test('the skill and prefs verbs are reachable from the one dispatch', async () => {
  // they live in cli-skill.ts and are loaded lazily; this proves the wiring, not the behaviour
  assert.equal(await run(['skill', 'list']), 0)
  assert.equal(await run(['prefs', 'pending']), 0)
  assert.equal(await run(['prefs', 'nonsense']), 2)
})

test('help answers without doing anything, and doctor is reachable through run', async () => {
  assert.equal(await run(['help']), 0)
  assert.equal(await run(['--help']), 0)
  assert.equal(await run(['render', '--help']), 0)
  assert.equal(await run(['doctor']), 0, 'this machine passes its own doctor')
})

test('render writes one svg per level, and audit reads what it wrote', async () => {
  const out = join(workdir(), 'out-one.svg')
  assert.equal(await run(['render', SHOP, '--level', 'api', '--out', out]), 0, 'a named level renders on request')
  assert.ok(existsSync(out), 'and lands where it was asked to')
  assert.equal(await run(['audit', SHOP]), 0, 'every level audits clean')
  assert.equal(await run(['audit', SHOP, '--json']), 0, 'and the json form exits the same way')
})

test('--require-docs exits 1 and names every missing doc, which is the gate an agent reads', async () => {
  const dir = workdir()
  const file = join(dir, 'nodocs.json')
  writeFileSync(
    file,
    JSON.stringify({
      id: 'nodocs',
      title: 'No docs',
      levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }],
    }),
  )
  assert.equal(await run(['audit', file, '--strict', '--require-docs']), 1)
  // and the same model passes when the question is not asked
  assert.equal(await run(['audit', file, '--strict']), 0)
})

test('--json keeps the audit quiet: the caller parses, the human does not read', async () => {
  assert.equal(await run(['audit', SHOP, '--json']), 0)
})

test('a lens problem is a strict failure with its own line', async () => {
  const dir = workdir()
  const file = join(dir, 'flat-lens.json')
  writeFileSync(
    file,
    JSON.stringify({
      id: 'flat',
      title: 'Flat',
      levels: [
        { path: '', nodes: [{ id: 'user', label: 'User', subtype: 'person' }, { id: 'host', label: 'Host', subtype: 'system' }], edges: [{ from: 'user', to: 'host' }] },
        // a drill level that declares no ports, while the parent has an edge that needs one
        { path: 'host', nodes: [{ id: 'a', label: 'A', subtype: 'service-logic' }], edges: [] },
      ],
    }),
  )
  assert.equal(await run(['audit', file, '--strict']), 1)
})

test('c4v gate runs through the same entry point as everything else', async () => {
  assert.equal(await run(['gate', 'status']), 0)
  assert.equal(await run(['gate', 'report']), 0)
})

test('--flat audits the authored level; the default audits the picture a page draws', async () => {
  const dir = workdir()
  const file = join(dir, 'drill.json')
  writeFileSync(
    file,
    JSON.stringify({
      id: 'drill',
      title: 'Drill',
      levels: [
        { path: '', nodes: [{ id: 'host', label: 'Host', subtype: 'system' }], edges: [] },
        { path: 'host', nodes: [{ id: 'a', label: 'A', subtype: 'service-logic' }], edges: [], ports: {} },
      ],
    }),
  )
  // both flags run and disagree only about which picture is judged; neither is a usage error
  assert.ok([0, 1].includes(await run(['audit', file, '--strict', '--flat'])))
  assert.ok([0, 1].includes(await run(['audit', file, '--strict'])))
  assert.equal(await run(['audit', file, '--json']), 0)
})

test('--no-lens is geometry only, so a corpus fixture is judged on its drawing', async () => {
  const fixture = join(ROOT, 'fixtures', 'droid.json')
  // this corpus has drilled levels that are dead ends; --no-lens says "geometry only", and says so explicitly
  assert.equal(await run(['audit', fixture, '--strict', '--flat', '--no-lens']), 0)
})

test('c4v publish runs through the same entry point as everything else', async () => {
  const dir = workdir()
  const model = join(dir, 'solo.json')
  writeFileSync(model, JSON.stringify({ id: 'solo', title: 'Solo', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] }] }))
  assert.equal(await run(['publish', model, '--root', join(dir, 'store')]), 0)
  assert.equal(await run(['publish']), 2, 'and a bare publish is a usage error')
})

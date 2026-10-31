/**
 * The command line, tested as a command line.
 *
 * Every case here is an exit code an agent branches on, so a silent change to one is a broken
 * contract: 0 clean, 1 strict gate failure, 2 unusable invocation.
 */
import { test } from 'node:test'
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

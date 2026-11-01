/**
 * `c4v publish` — the bridge between a repo's layout and the viewer's store. Without it a model published by
 * POST had no docs, so the hover panel a reader is promised was empty.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishCommand } from '../src/cli-publish.ts'

/** docs/c4/shop.json + docs/c4/shop/{nodes,edges}— the layout a repo uses. */
function repo(): { file: string; root: string } {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-publish-'))
  const c4 = join(dir, 'docs', 'c4')
  mkdirSync(join(c4, 'shop', 'nodes'), { recursive: true })
  mkdirSync(join(c4, 'shop', 'edges'), { recursive: true })
  const file = join(c4, 'shop.json')
  writeFileSync(file, JSON.stringify({
    id: 'shop',
    title: 'Shop',
    levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }, { id: 'b', label: 'B', subtype: 'system' }], edges: [{ from: 'a', to: 'b' }] }],
  }))
  writeFileSync(join(c4, 'shop', 'nodes', 'a.md'), '# A\n\nThe first box.')
  writeFileSync(join(c4, 'shop', 'edges', 'a__b.md'), '# a to b\n\nThe call.')
  return { file, root: join(dir, 'store') }
}

const run = (argv: string[]): number => {
  const lines: string[] = []
  const { log, error } = console
  console.log = (...a: unknown[]) => lines.push(a.join(' '))
  console.error = (...a: unknown[]) => lines.push(a.join(' '))
  try {
    return publishCommand(argv)
  } finally {
    console.log = log
    console.error = error
  }
}

test('publish copies the model and both doc directories into the store', () => {
  const { file, root } = repo()
  assert.equal(run(['publish', file, '--root', root]), 0)
  assert.ok(existsSync(join(root, 'shop', 'model.json')), 'the model is stored')
  assert.match(readFileSync(join(root, 'shop', 'shop', 'nodes', 'a.md'), 'utf8'), /first box/)
  assert.match(readFileSync(join(root, 'shop', 'shop', 'edges', 'a__b.md'), 'utf8'), /The call/)
})

test('--as stores the diagram under another id and keeps the docs', () => {
  const { file, root } = repo()
  assert.equal(run(['publish', file, '--root', root, '--as', 'shop-copy']), 0)
  const stored = JSON.parse(readFileSync(join(root, 'shop-copy', 'model.json'), 'utf8')) as { id: string }
  assert.equal(stored.id, 'shop-copy', 'the stored model carries the new id')
  assert.ok(existsSync(join(root, 'shop-copy', 'shop-copy', 'nodes', 'a.md')), 'and the docs follow it')
})

test('a model with no docs publishes and says the hover will be empty', () => {
  const { file, root } = repo()
  const bare = join(file, '..', 'bare.json')
  writeFileSync(bare, JSON.stringify({ id: 'bare', title: 'Bare', levels: [{ path: '', nodes: [{ id: 'x', label: 'X', subtype: 'system' }], edges: [] }] }))
  assert.equal(run(['publish', bare, '--root', root]), 0)
  assert.ok(existsSync(join(root, 'bare', 'model.json')))
})

test('publishing without a file, with a bad model, or with a bad --as is a usage error', () => {
  const { file, root } = repo()
  assert.equal(run(['publish']), 2)
  assert.equal(run(['publish', join(root, 'nope.json'), '--root', root]), 2)
  assert.equal(run(['publish', file, '--root', root, '--as', 'Not An Id']), 2)
})

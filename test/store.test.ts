/**
 * The store, on its own: what happens to a directory that is missing, a file that is not JSON, and a build
 * stamp asked for by a checkout with no package.json.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { list } from '../src/store.ts'
import { buildStamp, readVersion } from '../src/build.ts'

const root = mkdtempSync(join(tmpdir(), 'c4v-store-'))

test('a store directory that does not exist yet lists nothing instead of throwing', () => {
  assert.deepEqual(list(join(tmpdir(), 'c4v-no-store-here')), [])
})

test('a half-written model in the store is skipped by the listing, not fatal', () => {
  mkdirSync(join(root, 'half-written'), { recursive: true })
  writeFileSync(join(root, 'half-written', 'model.json'), '{"id": "half-written", "levels": [')
  writeFileSync(join(root, 'not-a-diagram.txt'), 'stray file in the store root')
  assert.ok(!list(root).some((d) => d.id === 'half-written'), 'a corrupt model is not offered')
})

test('the stamp is the version the process loaded, plus when it started', () => {
  assert.match(buildStamp(), /^\d+\.\d+\.\d+@\d+$/, 'a stale process keeps its own version')
  assert.equal(readVersion(() => { throw new Error('no package.json') }), 'dev')
})

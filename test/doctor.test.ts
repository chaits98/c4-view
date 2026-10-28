/**
 * A fresh machine fails in exactly four ways: old Node, missing viewer assets, an unwritable store,
 * no browser for PNG. `c4v doctor` names each one, so these tests hold it to that.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checks, doctor } from '../src/doctor.ts'
import { run } from '../src/cli.ts'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'c4v-doctor-'))

test('every required check passes on this machine', () => {
  const rows = checks(scratch())
  const failed = rows.filter((row) => row.required && !row.ok)
  assert.deepEqual(failed, [], `required failures: ${failed.map((row) => `${row.name}: ${row.detail}`).join('; ')}`)
  assert.ok(rows.some((row) => row.name === 'node' && row.ok))
  assert.ok(rows.some((row) => row.name === 'font table' && row.ok))
  // chromium is optional by design: the SVG is the artifact
  assert.equal(rows.find((row) => row.name === 'chromium')?.required, false)
})

test('an unusable store is a required failure, not a crash', () => {
  const file = join(scratch(), 'not-a-dir')
  writeFileSync(file, 'x')
  const store = checks(file).find((row) => row.name === 'store')
  assert.ok(store)
  assert.equal(store.ok, false)
  assert.equal(store.required, true)
})

test('doctor() returns false when a required check fails, without throwing', () => {
  const file = join(scratch(), 'file')
  writeFileSync(file, 'x')
  assert.equal(doctor(file), false)
  rmSync(file, { force: true })
})

test('c4v doctor exits 0 with a writable store', async () => {
  assert.equal(await run(['doctor', '--root', scratch()]), 0)
})

test('c4v doctor exits 1 with an unusable store', async () => {
  const file = join(scratch(), 'file')
  writeFileSync(file, 'x')
  assert.equal(await run(['doctor', '--root', file]), 1)
})

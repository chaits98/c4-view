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

test('a browser named in the environment is used, and a wrong path is reported as a note, not a failure', () => {
  const saved = process.env.C4_CHROMIUM
  try {
    process.env.C4_CHROMIUM = '/bin/sh'
    const withBrowser = checks(scratch()).find((row) => row.name === 'chromium')
    assert.equal(withBrowser?.ok, true, 'an executable path is taken at its word')
    assert.equal(withBrowser?.required, false, 'but PNG is never a requirement')

    process.env.C4_CHROMIUM = '/nowhere/chrome'
    const without = checks(scratch()).find((row) => row.name === 'chromium')
    assert.equal(without?.ok, false, 'a path that is not there is not a browser')
    assert.match(without?.detail ?? '', /C4_CHROMIUM/, 'and the row says which variable to set')
  } finally {
    if (saved === undefined) delete process.env.C4_CHROMIUM
    else process.env.C4_CHROMIUM = saved
  }
})

test('a store that cannot be written is a FAIL, and doctor returns false for it', () => {
  const blocked = join(scratch(), 'file-not-dir')
  writeFileSync(blocked, 'x')
  const rows = checks(join(blocked, 'store'))
  const store = rows.find((row) => row.name === 'store')
  assert.equal(store?.ok, false)
  assert.equal(store?.required, true, 'an unwritable store is not a note')
  assert.match(store?.detail ?? '', /store/, 'and the detail names the path')

  const out = console.log
  console.log = () => {}
  try {
    assert.equal(doctor(join(blocked, 'store')), false, 'doctor answers false when a requirement fails')
  } finally {
    console.log = out
  }
})

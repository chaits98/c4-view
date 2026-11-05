/**
 * Two things a stranger hits first: asking which version is installed, and being told WHY a model was
 * refused. A message that says "geometry" for an undeclared state sends them to nudge coordinates that
 * are already correct.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../src/cli.ts'

test('--version answers with the loaded build, and does not need a model', async () => {
  const out: string[] = []
  const { log } = console
  console.log = (...a: unknown[]) => void out.push(a.join(' '))
  try {
    assert.equal(await run(['--version']), 0)
  } finally {
    console.log = log
  }
  assert.match(out.join('\n'), /^\d+\.\d+\.\d+@\d+$/)
})

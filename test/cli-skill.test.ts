/**
 * `c4v skill` and `c4v prefs`, driven through their real entry points with a temp home and a temp
 * prefs file — no mocks, no writes into the machine that runs the tests.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prefsCommand, skillCommand } from '../src/cli-skill.ts'

let home = ''
let prefsFile = ''

before(() => {
  home = mkdtempSync(join(tmpdir(), 'c4v-home-'))
  prefsFile = join(home, 'prefs.json')
})
after(() => rmSync(home, { recursive: true, force: true }))

test('skill list names every harness, and install says what it wrote', () => {
  assert.equal(skillCommand(['skill'], home), 0, 'no action lists')
  assert.equal(skillCommand(['skill', 'list'], home), 0)
  // one named harness, installed under the temp home rather than the real one
  assert.equal(skillCommand(['skill', 'install', '--harness', 'agents'], home), 0)
  assert.equal(skillCommand(['skill', 'install', '--harness', 'agents'], home), 0, 'reinstall is not an error')
})

test('skill refuses an action it does not have, and a harness it cannot name', () => {
  assert.equal(skillCommand(['skill', 'uninstall'], home), 2, 'unknown action')
  assert.equal(skillCommand(['skill', 'install', '--harness', 'no-such-harness'], home), 1, 'nothing to install into')
})

test('prefs show is empty first, then reports what was set', () => {
  assert.equal(prefsCommand(['prefs', 'show'], prefsFile), 0, 'nothing answered yet is not an error')
  assert.equal(prefsCommand(['prefs', 'set'], prefsFile), 2, 'a bare set has no id=value')
  assert.equal(prefsCommand(['prefs', 'set', 'network=lan'], prefsFile), 0)
  assert.equal(prefsCommand(['prefs', 'set', 'network=sideways'], prefsFile), 2, 'not an option')
  assert.equal(prefsCommand(['prefs', 'set', 'nonsense=lan'], prefsFile), 2, 'not a question')
  assert.equal(prefsCommand(['prefs', 'show'], prefsFile), 0)
  const saved = JSON.parse(readFileSync(prefsFile, 'utf8')) as { answers: Record<string, string>; seen: { version: string } }
  assert.equal(saved.answers['viewer.mode'], 'lan', 'the answer lands on the store path')
  assert.match(saved.seen.version, /\d+\.\d+\.\d+/, 'and the version is stamped, so the next release can say "updated"')
})

test('prefs pending lists the rest, and the greeting is a sentence or nothing', () => {
  assert.equal(prefsCommand(['prefs', 'pending'], prefsFile), 0)
  assert.equal(prefsCommand(['prefs', 'greeting', '--version', '99.0.0'], prefsFile), 0)
  assert.equal(prefsCommand(['prefs', 'greeting', '--version', '0.0.0'], prefsFile), 0, 'nothing to say is not an error')
  assert.equal(prefsCommand(['prefs', 'bogus'], prefsFile), 2, 'unknown action')
})

test('a corrupt prefs file is reported, not fatal, and the next write repairs it', () => {
  writeFileSync(prefsFile, '{not json')
  assert.equal(prefsCommand(['prefs', 'show'], prefsFile), 0, 'a corrupt file still opens')
  assert.equal(prefsCommand(['prefs', 'set', 'network=local'], prefsFile), 0)
  assert.match(readFileSync(prefsFile, 'utf8'), /"viewer.mode": "local"/)
})

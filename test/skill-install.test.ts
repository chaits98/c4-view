/**
 * The install surface: a JSONL registry decides where the skill goes, and a JSONL question set decides what
 * the user is asked once. Both are data, so these tests are about the data contract as much as the code.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, detected, expand, harnesses, installInto, isSkillDir, plan } from '../src/skill-install.ts'
import { answer, greeting, loadPrefs, pending, questions, savePrefs } from '../src/prefs.ts'

const home = (): string => mkdtempSync(join(tmpdir(), 'c4v-home-'))

test('the harness registry parses, and every line is usable', () => {
  const all = harnesses()
  assert.ok(all.length >= 10, `expected the full harness list, got ${all.length}`)
  for (const harness of all) {
    assert.match(harness.id, /^[a-z0-9-]+$/, harness.id)
    assert.ok(harness.dir, `${harness.id} has no dir`)
    assert.ok(['global', 'project'].includes(harness.scope), `${harness.id} scope is ${harness.scope}`)
    assert.ok(harness.label, `${harness.id} has no label`)
  }
  // the interoperable directory must exist in the list, or most harnesses lose their install
  assert.ok(all.some((h) => h.dir.includes('.agents/skills')), 'no .agents/skills target')
})

test('a harness is only "present" when its marker exists', () => {
  const fake = home()
  const claude = harnesses().find((h) => h.id === 'claude-code')
  assert.ok(claude)
  assert.equal(detected(claude, fake), false)
  mkdirSync(join(fake, '.claude'), { recursive: true })
  assert.equal(detected(claude, fake), true)
})

test('--global installs into every DETECTED global harness, and nothing else', () => {
  const fake = home()
  mkdirSync(join(fake, '.claude'), { recursive: true })
  mkdirSync(join(fake, '.agents'), { recursive: true })
  const chosen = plan(harnesses(), { global: true, home: fake })
  const ids = chosen.map((c) => c.harness.id).sort()
  assert.deepEqual(ids, ['agents', 'claude-code'])
  assert.ok(chosen.every((c) => c.reason === 'detected'))
})

test('naming a harness installs it even when detection is unsure, and never the project one', () => {
  const fake = home()
  const chosen = plan(harnesses(), { global: true, named: ['gemini'], home: fake })
  assert.deepEqual(chosen.map((c) => c.harness.id), ['gemini'])
  assert.equal(chosen[0].reason, 'named')
  const project = plan(harnesses(), { global: true, home: fake }).find((c) => c.harness.scope === 'project')
  assert.equal(project, undefined, 'project scope must never be implied by --global')
})

test('installInto copies the whole skill and leaves the smoke-prompt behind', () => {
  const fake = home()
  const target = installInto(harnesses().find((h) => h.id === 'agents')!, fake)
  const files = readdirSync(target)
  assert.ok(files.includes('SKILL.md'))
  assert.ok(files.includes('assets'), 'the worked example must travel with the skill')
  assert.ok(files.includes('preferences.jsonl'), 'the question set must travel with the skill')
  assert.ok(!files.includes('SMOKE-PROMPT.md'), 'test harness notes are not part of the shipped skill')
  assert.ok(isSkillDir())
})

test('a corrupt preferences file does not brick the tool', () => {
  const fake = home()
  const file = join(fake, 'prefs.json')
  writeFileSync(file, '{ not json')
  assert.deepEqual(loadPrefs(file).answers, {})
})

test('pending lists exactly the unanswered questions, and answering one removes it', () => {
  const all = questions()
  assert.ok(all.length >= 2)
  const empty = { seen: null, answers: {} }
  assert.equal(pending(all, empty).length, all.length)
  const one = answer(all, empty, 'network', 'share on the local network (needs a token)')
  assert.equal(pending(all, one).length, all.length - 1)
  // the stored value is the short form, not the sentence the user picked
  assert.equal(one.answers['viewer.mode'], 'lan')
})

test('an answer that is not an option is rejected with the options named', () => {
  const all = questions()
  assert.throws(() => answer(all, { seen: null, answers: {} }, 'network', 'maybe'), /not one of/)
  assert.throws(() => answer(all, { seen: null, answers: {} }, 'nope', 'x'), /unknown question/)
})

test('a new question in the set is pending for an existing user (the update path)', () => {
  const file = join(home(), 'preferences.jsonl')
  const all = questions()
  writeFileSync(file, all.map((q) => JSON.stringify(q)).join('\n') + '\n')
  // answer every question the set currently has, then add one more below
  const answered = {
    seen: { version: '0.2.2', at: 'then' },
    answers: Object.fromEntries(questions(file).map((q) => [q.store, 'answered'])),
  }
  assert.equal(pending(questions(file), answered).length, 0, 'nothing pending when all are answered')

  const nextQuestion = {
    id: 'flow-speed',
    since: '0.3.0',
    question: 'How fast should the data-flow animation run?',
    options: ['slow', 'normal', 'fast'],
    default: 'normal',
    why: 'the animation is the product, and speed is personal',
    store: 'viewer.speed',
  }
  writeFileSync(file, [...all.map((q) => JSON.stringify(q)), JSON.stringify(nextQuestion)].join('\n') + '\n')
  const waiting = pending(questions(file), answered)
  assert.deepEqual(waiting.map((q) => q.id), ['flow-speed'])
})

test('the greeting is a sentence, not a form, and stays quiet when there is nothing to say', () => {
  const all = questions()
  const fresh = greeting(all, { seen: null, answers: {} }, '0.2.2')
  assert.match(fresh ?? '', /^c4-view has .*question/)
  assert.doesNotMatch(fresh ?? '', /!/, 'no exclamation marks: this is furniture, not marketing')

  const settled = { seen: { version: '0.2.2', at: 'now' }, answers: Object.fromEntries(all.map((q) => [q.store, 'x'])) }
  assert.equal(greeting(all, settled, '0.2.2'), null, 'silent when the user is up to date')
  assert.match(greeting(all, settled, '0.3.0') ?? '', /updated to 0\.3\.0/)
})

test('prefs round-trip through disk', () => {
  const file = join(home(), 'prefs.json')
  const prefs = { seen: { version: '0.2.2', at: 'now' }, answers: { 'viewer.mode': 'lan' } }
  savePrefs(prefs, file)
  assert.deepEqual(loadPrefs(file), prefs)
  assert.equal(readFileSync(file, 'utf8').includes('lan'), true)
})

test('expand handles ~, ~/x and relative paths', () => {
  assert.equal(expand('~', '/home/t'), '/home/t')
  assert.equal(expand('~/.claude/skills', '/home/t'), '/home/t/.claude/skills')
  assert.equal(expand('.agents/skills', '/home/t', '/repo'), '/repo/.agents/skills')
})

test('describe marks present vs installed without throwing on a bare machine', () => {
  const lines = describe(harnesses(), { home: home() })
  assert.equal(lines.length, harnesses().length)
  assert.ok(lines.every((line) => line.startsWith('  ')))
})

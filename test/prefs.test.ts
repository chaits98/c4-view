/**
 * The interview. Two shapes of question: one with a `values` map (the label shown, the value stored)
 * and one without (the label is the value). Every branch in `resolveAnswer` is about keeping those
 * honest — a silently stored typo is a preference that never takes effect.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answer, greeting, loadPrefs, pending, questions, type Question } from '../src/prefs.ts'

const choice: Question = {
  id: 'viewer.mode',
  since: '0.1.0',
  question: 'How should the viewer open?',
  options: ['fit to width', 'actual size'],
  default: 'fit',
  why: 'so a wide diagram is readable on a laptop',
  store: 'viewer.mode',
  values: { 'fit to width': 'fit', 'actual size': 'actual' },
}
/** No `values` map: the label IS what gets stored, and the options still bound the answers. */
const plain: Question = {
  id: 'team.name',
  since: '0.4.0',
  question: 'Which team owns this system?',
  options: ['Payments', 'Platform'],
  default: 'Payments',
  why: 'the diagrams carry a name',
  store: 'team.name',
}

const empty = { seen: null, answers: {} }

test('a choice accepts its label, its stored value, and nothing else', () => {
  assert.deepEqual(answer([choice], empty, choice.id, 'fit to width').answers, { 'viewer.mode': 'fit' })
  assert.deepEqual(answer([choice], empty, choice.id, 'actual').answers, { 'viewer.mode': 'actual' })
  assert.throws(() => answer([choice], empty, choice.id, 'sideways'), /is not one of: fit to width \| actual size \| fit \| actual/)
  assert.throws(() => answer([choice], empty, choice.id, ''), /is not one of/)
})

test('without a values map the label is stored verbatim, and still bounded', () => {
  assert.deepEqual(answer([plain], empty, plain.id, 'Platform').answers, { 'team.name': 'Platform' })
  assert.throws(() => answer([plain], empty, plain.id, 'payments'), /is not one of: Payments \| Platform/, 'case matters')
  assert.throws(() => answer([plain], empty, plain.id, '   '), /is not one of/, 'blank is not an answer')
})

test('an unknown question is named, not silently stored', () => {
  assert.throws(() => answer([choice], empty, 'nope', 'x'), /unknown question "nope"/)
})

test('pending is what the question set has and the answers do not', () => {
  assert.deepEqual(pending([choice, plain], empty).map((q) => q.id), ['viewer.mode', 'team.name'])
  const half = answer([choice], empty, choice.id, 'fit')
  assert.deepEqual(pending([choice, plain], half).map((q) => q.id), ['team.name'])
  assert.deepEqual(pending([choice], half), [], 'nothing left to ask')
})

test('the greeting is one line: a question, a change, or silence', () => {
  assert.match(greeting([choice], empty, '0.4.0') ?? '', /one question/)
  assert.match(greeting([choice, plain], empty, '0.4.0') ?? '', /2 quick questions/)
  const answered = { seen: { version: '0.3.0', at: '2026-01-01T00:00:00Z' }, answers: { 'viewer.mode': 'fit', 'team.name': 'Payments' } }
  assert.match(greeting([choice, plain], answered, '0.4.0') ?? '', /updated to 0\.4\.0/)
  assert.equal(greeting([choice, plain], { ...answered, seen: { version: '0.4.0', at: 'x' } }, '0.4.0'), null, 'same version, nothing to say')
  assert.equal(greeting([choice, plain], { seen: null, answers: answered.answers }, '0.4.0'), null, 'no version seen and nothing pending')
})

test('the bundled question set parses, and a missing file is not a crash', () => {
  const all = questions()
  assert.ok(all.length > 0, 'the skill ships questions')
  for (const q of all) {
    assert.match(q.id, /^[a-z][a-z.-]+$/, `${q.id} is a lowercase click-name`)
    assert.ok(q.options.length > 0 && q.values, `${q.id} offers choices a user can pick`)
    assert.ok(q.store.length > 0, `${q.id} says where the answer goes`)
  }
  assert.deepEqual(questions('/nonexistent/preferences.jsonl'), [])
})

test('a stored prefs file that is not JSON falls back to empty', () => {
  assert.deepEqual(loadPrefs().answers, {}, 'this machine has no prefs yet, or a valid file')
})

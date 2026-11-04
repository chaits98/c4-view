/**
 * The flow-control contract, as a test rather than an opinion (checklist item 3).
 *
 * These are the rules `public/flow.js` obeys: the caption shape, the five keys plus
 * replay/stop, the button face, and when the live region may speak. The DOM wiring is
 * verified against the running server by looking at it — this file is what fails first
 * when the rules themselves change.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionOf, caption, face, live, travel } from '../public/flow-model.js'

test('caption is `{from} → {to} · {label} · {n} / {total}`', () => {
  const line = caption('Application core', 'Native telemetry', 'ASGI scope', 0, 9)
  assert.equal(line, 'Application core → Native telemetry · ASGI scope · 1 / 9')
  assert.match(line, /^.+ → .+ · \S.* · 1 \/ 9$/)
  assert.equal(caption('a', 'b', 'c', 8, 9).endsWith('9 / 9'), true, 'the last step is `{total} / {total}`')
})

test('a missing label prints `unnamed`, never an empty field', () => {
  assert.equal(caption('Sync', 'Queue', '', 2, 4), 'Sync → Queue · unnamed · 3 / 4')
  assert.equal(caption('Sync', 'Queue', undefined, 2, 4), 'Sync → Queue · unnamed · 3 / 4')
})

test('the bar answers Space, arrows, Home, End, r and Escape — and nothing else', () => {
  const key = (k) => actionOf({ key: k })
  assert.equal(key(' '), 'toggle')
  assert.equal(key('ArrowRight'), 'next')
  assert.equal(key('ArrowLeft'), 'prev')
  assert.equal(key('Home'), 'first')
  assert.equal(key('End'), 'last')
  assert.equal(key('r'), 'replay')
  assert.equal(key('Escape'), 'stop')
  assert.equal(key('Tab'), null, 'tab is the browser\'s')
  assert.equal(key('a'), null)
})

test('modifier combinations stay with the browser', () => {
  for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
    assert.equal(actionOf({ key: 'ArrowRight', [mod]: true }), null, mod)
    assert.equal(actionOf({ key: ' ', [mod]: true }), null, mod)
  }
})

test('the primary button is Play, then Pause, then Replay at the last edge', () => {
  assert.deepEqual(face(0, 9, false), { word: 'Play', glyph: '▶', state: 'play', replay: false })
  assert.deepEqual(face(3, 9, true), { word: 'Pause', glyph: '⏸', state: 'pause', replay: false })
  assert.deepEqual(face(8, 9, false), { word: 'Replay', glyph: '↻', state: 'replay', replay: true }, 'at the end, off')
  assert.equal(face(0, 1, false).word, 'Replay', 'a one-flow diagram is already at its end')
})

test('the live region is quiet while playing and polite when stepping', () => {
  assert.equal(live(true), 'off')
  assert.equal(live(false), 'polite')
})

test('a step lasts as long as its description takes to read', () => {
  assert.equal(travel(''), 900, 'an edge with nothing to say still gets the floor')
  assert.equal(travel(undefined), 900)
  assert.equal(travel('x'.repeat(20)), 2000, '900 ms + 55 ms per character')
  assert.ok(travel('x'.repeat(80)) > travel('x'.repeat(40)), 'a longer sentence gets more time')
  assert.equal(travel('x'.repeat(500)), 7000, 'capped: past seven seconds the reader can step by hand')
})

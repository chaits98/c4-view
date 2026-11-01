/**
 * Text measurement is the one thing every stage trusts: if a width is wrong, a box is wrong, and
 * the emitter draws outside it. These are the branches a wrapping pass actually hits — a word that
 * fits, a word that must move, and a word longer than the line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FONT_FAMILY, lineHeight, measure, textWidth, wrapText } from '../src/metrics.ts'

test('width scales with size and lands on half pixels', () => {
  const at13 = textWidth('Ranked', 13)
  const at26 = textWidth('Ranked', 26)
  assert.ok(at13 > 0)
  assert.ok(Math.abs(at26 - at13 * 2) <= 1, `${at13} → ${at26}`)
  assert.equal(at13 * 2, Math.round(at13 * 2 * 2) / 2, 'half-pixel resolution')
  assert.ok(textWidth('', 13) === 0, 'no glyphs, no width')
})

test('an unknown glyph still measures (the fallback advance)', () => {
  assert.ok(textWidth('\u{10FFFD}', 13) > 0)
  assert.match(FONT_FAMILY, /DejaVu Sans/)
})

test('wrap keeps words that fit and moves the one that does not', () => {
  const width = textWidth('alpha beta', 13)
  assert.deepEqual(wrapText('alpha beta', width + 1, 13), ['alpha beta'], 'one line when it fits')
  const narrow = Math.ceil(textWidth('alpha', 13))
  assert.deepEqual(wrapText('alpha beta', narrow, 13), ['alpha', 'beta'], 'two lines when it does not')
})

test('a word longer than the line is hard-split, never clipped', () => {
  const lines = wrapText('supercalifragilistic', 24, 13)
  assert.ok(lines.length > 1, 'split into pieces')
  for (const line of lines) assert.ok(textWidth(line, 13) <= 24, `${line} still too wide`)
  assert.equal(lines.join(''), 'supercalifragilistic', 'no character lost')
})

test('blank text is one empty line, not zero lines', () => {
  assert.deepEqual(wrapText('   ', 100, 13), [''])
  assert.deepEqual(wrapText('', 100, 13), [''])
})

test('the measure object is what the layout receives', () => {
  assert.equal(measure.width, textWidth)
  assert.equal(measure.wrap, wrapText)
  assert.equal(lineHeight(13), 18)
  assert.equal(lineHeight(9), 13)
})

/** The reading size: a ladder step, or one of the three ways to fit. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ZOOM_PRESETS, sizeOf, zoomBar, zoomClass, zoomOf } from '../src/viewer-zoom.ts'

test('the four presets are the ways a reader wants to read', () => {
  assert.deepEqual(ZOOM_PRESETS.map(([v]) => v), ['fit', 'fit-w', 'fit-h', '1'])
})

test('each zoom value names exactly one class', () => {
  assert.equal(zoomClass(null), 'zoom-fit')
  assert.equal(zoomClass('fit-w'), 'zoom-fit-w')
  assert.equal(zoomClass('fit-h'), 'zoom-fit-h')
  assert.equal(zoomClass(1.25), 'zoom-125')
})

test('the bar marks the current preset, and only names a size no preset covers', () => {
  const href = (v: string): string => `?zoom=${v}`
  const fitW = zoomBar(href, 'fit-w')
  assert.match(fitW, /data-zoom="fit-w" aria-current="true"/)
  assert.ok(!fitW.includes('c4-zoom-readout'), 'a named preset needs no readout')
  const odd = zoomBar(href, 0.75)
  assert.match(odd, /c4-zoom-readout">75%</)
})

test('sizes read as percentages, and fit modes as words', () => {
  assert.equal(sizeOf(1), '100%')
  assert.equal(sizeOf('fit-w'), 'Fit W')
  assert.equal(sizeOf(null), 'Fit')
  assert.equal(zoomOf('fit-h'), 'fit-h')
})

test('nonsense, zero and negatives fall back to Fit', () => {
  assert.equal(zoomOf('bogus'), null)
  assert.equal(zoomOf('0'), null, 'zero is not a zoom')
  assert.equal(zoomOf('-2'), null)
  assert.equal(zoomOf('1.3'), 1.25, 'the nearest step wins')
  assert.equal(zoomOf(null), null)
})

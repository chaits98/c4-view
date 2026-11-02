/** The reading size: a ladder step, or one of the three ways to fit. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ZOOM_PRESETS, sizeOf, zoomBar, zoomClass, zoomOf } from '../src/viewer-zoom.ts'

test('each zoom value names exactly one class, and "open" picks the axis that shows everything', () => {
  const tall = { w: 300, h: 2700 }
  const wide = { w: 2700, h: 300 }
  assert.equal(zoomClass(null, tall), 'zoom-fit-v', 'a column opens fitted by height')
  assert.equal(zoomClass(null, wide), 'zoom-fit-h', 'a strip opens fitted by width')
  assert.equal(zoomClass('fit-v', wide), 'zoom-fit-v')
  assert.equal(zoomClass('fit-h', tall), 'zoom-fit-h')
  assert.equal(zoomClass(1.25, wide), 'zoom-125')
})

test('only two fits, and 100% — no third "contain" mode', () => {
  assert.deepEqual(ZOOM_PRESETS.map(([v]) => v), ['fit-v', 'fit-h', '1'])
  assert.equal(zoomOf('fit'), null, 'the old contain token now means "open size"')
  assert.equal(zoomOf('fit-w'), null, 'and so does the retired one')
})

test('the bar marks the current preset, and only names a size no preset covers', () => {
  const href = (v: string): string => `?zoom=${v}`
  const fitted = zoomBar(href, 'fit-h')
  assert.match(fitted, /data-zoom="fit-h" aria-current="true"/)
  assert.ok(!fitted.includes('c4-zoom-readout'), 'a named preset needs no readout')
  const odd = zoomBar(href, 0.75)
  assert.match(odd, /c4-zoom-readout">75%</)
})

test('sizes read as percentages, and fit modes as words', () => {
  assert.equal(sizeOf(1), '100%')
  assert.equal(sizeOf('fit-h'), 'Fit H')
  assert.equal(sizeOf('fit-v'), 'Fit V')
  assert.equal(zoomOf('fit-h'), 'fit-h')
})

test('nonsense, zero and negatives fall back to Fit', () => {
  assert.equal(zoomOf('bogus'), null)
  assert.equal(zoomOf('0'), null, 'zero is not a zoom')
  assert.equal(zoomOf('-2'), null)
  assert.equal(zoomOf('1.3'), 1.25, 'the nearest step wins')
  assert.equal(zoomOf(null), null)
})

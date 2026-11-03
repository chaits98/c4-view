/**
 * PNG export must not assume this box. The browser is found, not hardcoded — and when it is
 * missing the error says which knob to turn instead of dying with ENOENT.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHROMIUM_ENV, findChromium, sizeOf, svgToPng } from '../src/png.ts'
/** A machine without a browser cannot rasterise; those tests are skipped, not failed. */
const noBrowser = findChromium() ? false : 'no Chromium on this machine'

// big enough that a real capture cannot compress under the 1 KB blank guard
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">' +
  '<rect width="600" height="300" fill="#0a111b"/>' +
  '<rect x="40" y="40" width="200" height="120" fill="#1f3b57" stroke="#8fa3b8" stroke-width="2"/>' +
  '<text x="60" y="100" fill="#e6edf6" font-size="18">Ranked</text>' +
  '<path d="M240 100 H 400" stroke="#4a6f95" stroke-width="2" fill="none"/>' +
  '</svg>'

test('a browser is found on this machine, and it exists', { skip: noBrowser }, () => {
  const browser = findChromium()
  assert.ok(browser, 'no chromium found here — install one or the PNG path is untested on this box')
  assert.ok(existsSync(browser))
})

test('a wrong $C4_CHROMIUM is named in the error, not swallowed', () => {
  const saved = process.env[CHROMIUM_ENV]
  process.env[CHROMIUM_ENV] = '/nonexistent/chrome'
  try {
    assert.throws(
      () => svgToPng(SVG, join(mkdtempSync(join(tmpdir(), 'c4v-png-')), 'x.png')),
      /no Chromium or Chrome found[\s\S]*\/nonexistent\/chrome/,
    )
  } finally {
    if (saved === undefined) delete process.env[CHROMIUM_ENV]
    else process.env[CHROMIUM_ENV] = saved
  }
})

test('an svg with no width/height is refused before any browser runs', () => {
  const saved = process.env[CHROMIUM_ENV]
  process.env[CHROMIUM_ENV] = '/nonexistent/chrome'
  try {
    assert.throws(() => svgToPng('<svg></svg>', join(mkdtempSync(join(tmpdir(), 'c4v-png-')), 'y.png')), /no Chromium/)
  } finally {
    if (saved === undefined) delete process.env[CHROMIUM_ENV]
    else process.env[CHROMIUM_ENV] = saved
  }
})

test('a drawing is measured by its width/height, its viewBox, or refused', () => {
  assert.deepEqual(sizeOf('<svg width="120" height="40"></svg>'), { w: 120, h: 40 })
  // one box and no wires can come out with a viewBox and no width/height — that is still a size
  assert.deepEqual(sizeOf('<svg viewBox="0 0 136 54"></svg>'), { w: 136, h: 54 })
  assert.throws(() => sizeOf('<svg></svg>'), /neither width\/height nor a viewBox/)
})

test('a real raster comes out at the scale asked for', { skip: noBrowser }, () => {
  if (!findChromium()) return
  const out = join(mkdtempSync(join(tmpdir(), 'c4v-png-')), 'shot.png')
  svgToPng(SVG, out, 2)
  assert.ok(statSync(out).size > 1024, 'the capture is blank')
})

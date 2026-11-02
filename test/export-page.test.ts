/** The files a reader can take away: the page, the layers page, and the header controls. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModel } from '../src/model.ts'
import { exportLayers, exportOne } from '../src/export-page.ts'
import { composed, downloads, fullSpec, viewMode } from '../src/viewer-controls.ts'

const theme = 'dark' as const

const model = (): ReturnType<typeof parseModel> =>
  parseModel({
    id: 'shop',
    title: 'Shop & co',
    levels: [
      { path: '', nodes: [{ id: 'api', label: 'API', subtype: 'system' }], edges: [] },
      { path: 'api', title: 'API container', nodes: [{ id: 'db', label: 'DB', subtype: 'service-logic' }], edges: [], ports: { 'up->api': 'db' } },
    ],
  } as never)

test('one export is a self-contained page with the drawing inside it', () => {
  const html = exportOne(model(), '', false, theme)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<svg/)
  assert.ok(!/src=|href=/.test(html.slice(0, html.indexOf('<body'))), 'no external file to fetch: it opens offline')
  assert.match(html, /Shop &amp; co/, 'the title is escaped')
  assert.match(html, /overview/, 'a root-level export says what it is')
})

test('a level export names the level, and light asks for the light document', () => {
  const html = exportOne(model(), 'api', false, 'light' as const)
  assert.match(html, /Level api/)
  assert.match(html, /<body class="light">/)
})

test('the full export says every level and carries the nested picture', () => {
  const html = exportOne(model(), '', true, theme)
  assert.match(html, /every level/)
  assert.match(html, /Full diagram/)
  assert.match(html, /data-host="api"/, 'the nested picture is what gets exported')
})

test('all layers is the full diagram and nothing else', () => {
  const html = exportLayers(model(), theme)
  assert.equal((html.match(/<h2>/g) ?? []).length, 1, 'one picture: stacking the levels repeated them at other scales')
  assert.match(html, /<h2>Full diagram<\/h2>/)
  assert.match(html, /data-host="api"/, 'it is the nested picture, so every level is already inside it')
  assert.match(html, /2 levels in one picture/)
})

test('an exported drawing paints its own canvas — a file has no page behind it', () => {
  const dark = exportOne(model(), '', true, theme)
  assert.match(dark, /class="c4-canvas"/, 'the rect is there before any box')
  const light = exportOne(model(), '', true, 'light')
  assert.notEqual(
    /class="c4-canvas"[^>]*fill="([^"]+)"/.exec(dark)?.[1],
    /class="c4-canvas"[^>]*fill="([^"]+)"/.exec(light)?.[1],
    'two schemes, two canvases',
  )
})

test('the flow bar follows the page scheme, never a dark bar with dark ink', () => {
  const light = exportOne(model(), '', true, 'light')
  assert.match(light, /body\.light\{--c4-bar:#f3edf7;--c4-ink:#1d1b20\}/)
  assert.match(light, /background:var\(--c4-bar\);color:var\(--c4-ink\)/)
})

test('an exported page carries the flow narration, driven by the same module as the viewer', () => {
  const html = exportOne(model(), '', true, theme)
  assert.match(html, /<div id="c4-stage">/, 'the driver needs a stage')
  assert.match(html, /c4-flow-caption/, 'the caption bar is styled in the file')
  assert.match(html, /<script type="module">/, 'and the driver ships with it')
  const inlined = html.slice(html.indexOf('<script'))
  assert.ok(!/^import /m.test(inlined), 'the inlined module has no imports to resolve')
})

test('the download menu carries the level and the view it was asked from', () => {
  const drill = downloads('shop', 'api', false)
  assert.match(drill, /href="\/d\/shop\.svg\?level=api"/)
  assert.match(drill, /href="\/d\/shop\.html\?level=api"/)
  assert.match(drill, /href="\/d\/shop\.layers"/, 'every layer is the same file whatever level you are on')
  assert.match(downloads('shop', '', true), /href="\/d\/shop\.svg\?view=full"/)
  assert.match(downloads('shop', '', false), /href="\/d\/shop\.svg"/, 'no query when there is nothing to carry')
  assert.match(downloads('shop', '', false, 'light'), /theme=light/, 'the file keeps the scheme on screen')
})

test('the mode switch marks the one you are in', () => {
  assert.match(viewMode('/d/shop', 'drill'), /data-view="drill" aria-current="true"/)
  assert.match(viewMode('/d/shop', 'full'), /data-view="full" aria-current="true"/)
  assert.match(viewMode('/d/shop', 'full'), /href="\/d\/shop\?view=full"/)
})

test('the full page reports the root level as its text version', () => {
  assert.equal(fullSpec(model()).path, '')
  const notes = composed(model(), model().levels[0], theme)
  assert.equal(notes.spec.path, '')
  assert.match(notes.level.svg, /<svg/)
})

test('the layers download keeps the scheme as well', () => {
  assert.match(downloads('shop', '', false, 'light'), /href="\/d\/shop\.layers\?theme=light"/)
  assert.match(downloads('shop', '', false, 'auto'), /href="\/d\/shop\.layers"/, 'auto needs no parameter')
})

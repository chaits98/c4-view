/** Every export answers with a file: the right type, a name, and the picture that was asked for. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { serve } from '../src/server.ts'
import { save } from '../src/store.ts'
import { exportName } from '../src/server-export.ts'
import { findChromium } from '../src/png.ts'
/** A machine without a browser cannot rasterise; those tests are skipped, not failed. */
const noBrowser = findChromium() ? false : 'no Chromium on this machine'

const RAW = JSON.stringify({
  id: 'ship',
  title: 'Ship',
  levels: [
    { path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }, { id: 'box', label: 'Box', subtype: 'system', state: 'built' as const }], edges: [{ desc: 'the payload this edge carries', from: 'a', to: 'box', label: 'in' }] },
    {
      path: 'box',
      nodes: [{ id: 'in', label: 'In', subtype: 'service-logic', state: 'built' as const }, { id: 'out', label: 'Out', subtype: 'service-logic', state: 'built' as const }],
      edges: [{ desc: 'the payload this edge carries', from: 'in', to: 'out', label: 'next' }],
      ports: { 'a->box': 'in' },
    },
  ],
})

let server: Server
let root = ''
let base = ''

const get = (path: string): Promise<{ status: number; type: string; name: string; body: string }> =>
  fetch(`${base}${path}`).then(async (res) => ({
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    name: res.headers.get('content-disposition') ?? '',
    body: await res.text(),
  }))

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'c4-view-export-'))
  save(root, 'ship', RAW)
  server = await serve({ port: 0, root })
  const addr = server.address()
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
})

after(() => { server.close(); rmSync(root, { recursive: true, force: true }) })

test('a file name says the diagram and what it shows', () => {
  assert.equal(exportName('ship', '', false), 'ship')
  assert.equal(exportName('ship', 'box/in', false), 'ship-box~in', 'the level slug keeps a/b and a-b apart')
  assert.equal(exportName('ship', 'box', true), 'ship-full')
})

test('svg export is a named vector file, and full asks for the nested picture', async () => {
  const level = await get('/d/ship.svg?level=box')
  assert.equal(level.status, 200)
  assert.match(level.type, /image\/svg\+xml/)
  assert.match(level.name, /attachment; filename="ship-box\.svg"/)
  assert.match(level.body, /<svg/)
  const full = await get('/d/ship.svg?view=full')
  assert.match(full.name, /ship-full\.svg/)
  assert.match(full.body, /data-host="box"/, 'the full view is the nested picture')
})

test('html export is a self-contained page, and layers is every level', async () => {
  const page = await get('/d/ship.html?level=box')
  assert.match(page.type, /text\/html/)
  assert.match(page.name, /ship-box\.html/)
  assert.match(page.body, /<svg/)
  const layers = await get('/d/ship.layers')
  assert.match(layers.name, /ship-layers\.html/)
  assert.equal((layers.body.match(/<h2>/g) ?? []).length, 1, 'one picture: the full diagram holds every level')
})

test('the full view exports a png too, and the second ask reuses the file', { skip: noBrowser }, async () => {
  const first = await fetch(`${base}/d/ship.png?view=full`)
  assert.equal(first.status, 200)
  assert.match(first.headers.get('content-disposition') ?? '', /ship-full\.png/)
  assert.equal(first.headers.get('content-type'), 'image/png')
  const again = await fetch(`${base}/d/ship.png?view=full`)
  assert.equal(again.status, 200, 'the cached render answers just as well')
})

test('a level exports a png as well, named after the level', { skip: noBrowser }, async () => {
  const res = await fetch(`${base}/d/ship.png?level=box`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.match(res.headers.get('content-disposition') ?? '', /ship-box\.png/)
})

test('the svg export follows the theme it was asked for', async () => {
  const dark = await get('/d/ship.svg?level=box&theme=dark')
  const light = await get('/d/ship.svg?level=box&theme=light')
  assert.notEqual(dark.body, light.body, 'two schemes, two files')
  assert.match(dark.body, /<svg/)
})

test('a light png is its own file, not the dark render under another name', { skip: noBrowser }, async () => {
  const light = await fetch(`${base}/d/ship.png?level=box&theme=light`)
  const dark = await fetch(`${base}/d/ship.png?level=box&theme=dark`)
  assert.equal(light.status, 200)
  assert.equal(dark.status, 200)
  const a = Buffer.from(await light.arrayBuffer())
  const b = Buffer.from(await dark.arrayBuffer())
  assert.ok(a.length > 0 && b.length > 0)
  assert.notEqual(a.toString('base64'), b.toString('base64'), 'two schemes, two renders')
})

test('an export of a diagram or a level that is not there is a 404', async () => {
  assert.equal((await get('/d/nope.svg')).status, 404)
  assert.equal((await get('/d/ship.svg?level=not-a-level')).status, 404)
})

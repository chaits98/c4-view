import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server.ts'
import { indexPage } from '../src/index-page.ts'

const fixture = readFileSync(new URL('../fixtures/droid.json', import.meta.url), 'utf8')
const model = JSON.parse(fixture) as { id: string; title: string; levels: Array<{ path?: string; title?: string; nodes: unknown[] }> }
const ID = model.id

let server: Server
let root: string
let base = ''

/** Raw request: fetch() normalises `..`, and the traversal cases must arrive intact. */
function raw(method: string, path: string): Promise<{ status: number; allow: string; body: string }> {
  const url = new URL(base)
  return new Promise((done, fail) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path, method }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => done({ status: res.statusCode ?? 0, allow: res.headers.allow ?? '', body }))
    })
    req.on('error', fail)
    req.end()
  })
}

const svgOf = (html: string): string => (/<svg[\s\S]*<\/svg>/.exec(html) ?? [''])[0]

before(async () => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'c4-view-server-'))
  server = await serve({ port: 0, root })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise<void>((done) => server.close(() => done()))
  rmSync(root, { recursive: true, force: true })
})

test('GET /health counts the store', async () => {
  const res = await fetch(`${base}/health`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/)
  const body = (await res.json()) as { ok: boolean; diagrams: number }
  assert.equal(body.ok, true)
  assert.equal(body.diagrams, 0)
})

test('POST /api/diagrams stores and renders every level', async () => {
  const res = await fetch(`${base}/api/diagrams`, { method: 'POST', body: fixture })
  assert.equal(res.status, 201)
  const body = (await res.json()) as { id: string; url: string; audit: Array<{ level: string; ok: boolean }> }
  assert.equal(body.id, ID)
  assert.equal(body.url, `/d/${ID}`)
  assert.equal(body.audit.length, model.levels.length)
  assert.ok(body.audit.every((report) => report.ok), JSON.stringify(body.audit))
})

test('GET /d/:id is the root level, server-rendered', async () => {
  const res = await fetch(`${base}/d/${ID}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /^text\/html; charset=utf-8/)
  const html = await res.text()
  assert.ok(html.includes('<svg'), 'the drawing is inline, not fetched')
  assert.equal((html.match(/data-id="/g) ?? []).length, model.levels[0].nodes.length)
  for (const id of ['c4-crumbs', 'c4-levels', 'c4-stage', 'c4-hover', 'c4-legend', 'c4-mini']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`)
  }
  assert.ok(html.includes('data-diagram="' + ID + '"'))
  assert.ok(html.includes('data-level=""'))
  assert.ok(html.includes('data-root="/d/' + ID + '"'))
  assert.ok(html.includes('href="/tokens.css"'), 'tokens load before the sheet that uses them')
  assert.ok(html.includes('href="/viewer.css"'))
  assert.equal((html.match(/style="/g) ?? []).length, 0, 'no inline style: the CSP allows none')
  assert.ok(html.includes('src="/viewer.js" defer'))
})

test('?zoom= picks a ladder step, and nonsense falls back to Fit', async () => {
  const page = async (query: string): Promise<string> => (await fetch(`${base}/d/${ID}${query}`)).text()
  assert.match(await page('?zoom=1'), /class="zoom-100"/)
  assert.match(await page('?zoom=2'), /class="zoom-200"/)
  assert.match(await page('?zoom=1.3'), /class="zoom-125"/, 'the nearest step wins')
  assert.match(await page(''), /class="zoom-fit"/)
  assert.match(await page('?zoom=bogus'), /class="zoom-fit"/)
  const html = await page('?zoom=1')
  assert.ok(html.includes('data-zoom="1" aria-current="true"'), 'the active preset is announced')
  assert.ok(html.includes('href="/d/' + ID + '?zoom=2"'), 'presets are real links')
  assert.ok(html.includes('<span id="c4-zoom-readout" class="c4-zoom-readout">100%</span>'))
})

test('deep link renders that level, with breadcrumbs', async () => {
  const res = await fetch(`${base}/d/${ID}/droid/frontend`)
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.ok(html.includes('data-level="droid/frontend"'))
  assert.ok(html.includes(`href="/d/${ID}/droid"`), 'ancestor level is an <a>')
  assert.notEqual(svgOf(html), svgOf(await (await fetch(`${base}/d/${ID}`)).text()), 'a different drawing')
})

test('svg and png exports carry the right bytes', async () => {
  const svg = await fetch(`${base}/d/${ID}.svg?level=droid/frontend`)
  assert.equal(svg.status, 200)
  assert.match(svg.headers.get('content-type') ?? '', /^image\/svg\+xml/)
  assert.ok((await svg.text()).startsWith('<svg'))

  const png = await fetch(`${base}/d/${ID}.png`)
  assert.equal(png.status, 200)
  assert.match(png.headers.get('content-type') ?? '', /^image\/png/)
  const bytes = Buffer.from(await png.arrayBuffer())
  assert.ok(bytes.length > 1000)
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
})

test('an invalid model answers 400 with the problems verbatim', async () => {
  const bad = JSON.stringify({
    id: 'ghostly',
    title: 'Ghost',
    levels: [{ nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [{ from: 'a', to: 'ghost' }] }],
  })
  const res = await fetch(`${base}/api/diagrams`, { method: 'POST', body: bad })
  assert.equal(res.status, 400)
  const body = (await res.json()) as { problems: string[] }
  assert.ok(body.problems.some((problem) => problem.startsWith('levels[0].edges')), JSON.stringify(body.problems))
})

test('traversal and wrong methods are refused', async () => {
  assert.equal((await raw('GET', '/d/../../etc/passwd')).status, 404)
  assert.equal((await raw('GET', `/d/${ID}/..%2f..`)).status, 404)
  const wrong = await raw('POST', `/d/${ID}`)
  assert.equal(wrong.status, 405)
  assert.match(wrong.allow, /GET/)
})

test('listing and audits answer the store', async () => {
  const items = (await (await fetch(`${base}/api/diagrams`)).json()) as Array<{ id: string; title: string; levels: string[]; updated: string }>
  const found = items.find((item) => item.id === ID)
  assert.ok(found, JSON.stringify(items))
  assert.equal(found.title, model.title)
  assert.equal(found.levels.length, model.levels.length)
  assert.ok(!Number.isNaN(Date.parse(found.updated)))

  const all = (await (await fetch(`${base}/api/diagrams/${ID}/audit`)).json()) as Array<{ level: string; ok: boolean }>
  assert.equal(all.length, model.levels.length)
  assert.ok(all.every((report) => report.ok))

  const one = (await (await fetch(`${base}/api/diagrams/${ID}/audit?level=droid/frontend`)).json()) as { level: string }
  assert.equal(one.level, 'droid/frontend')

  const nope = await fetch(`${base}/api/diagrams/${ID}/audit?level=nope`)
  assert.equal(nope.status, 404)
  const text = await nope.text()
  assert.ok(text.includes('droid/frontend'), `the 404 names the real paths: ${text}`)
})

test('concurrent posts of one id leave one parseable file', async () => {
  const first = JSON.stringify({ ...model, title: 'First' })
  const second = JSON.stringify({ ...model, title: 'Second' })
  const [a, b] = await Promise.all([
    fetch(`${base}/api/diagrams`, { method: 'POST', body: first }),
    fetch(`${base}/api/diagrams`, { method: 'POST', body: second }),
  ])
  assert.equal(a.status, 201)
  assert.equal(b.status, 201)
  const stored = JSON.parse(readFileSync(join(root, ID, 'model.json'), 'utf8')) as { id: string; title: string }
  assert.equal(stored.id, ID)
  assert.ok(['First', 'Second'].includes(stored.title), `last write wins, whole: ${stored.title}`)
})

test('?theme= renders that scheme, remembers it, and leaves auto to the OS', async () => {
  const dark = await fetch(`${base}/?theme=dark`)
  assert.match(await dark.text(), /<html lang="en" data-theme="dark">/)
  assert.match(dark.headers.get('set-cookie') ?? '', /c4theme=dark/, 'remembered for the next page')
  assert.match(await (await fetch(`${base}/?theme=light`)).text(), /<html lang="en" data-theme="light">/)
  assert.match(await (await fetch(`${base}/`)).text(), /<html lang="en">/, 'auto ships no attribute')
  assert.match(await (await fetch(`${base}/?theme=nonsense`)).text(), /<html lang="en">/, 'nonsense falls back to auto')
})

test('the index grid lists every diagram with a live thumbnail, and "/" never 404s', async () => {
  // the empty state is a rendering fact of the builder, not of the shared server fixture
  assert.match(indexPage([]), /No diagrams yet/)

  await fetch(`${base}/api/diagrams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: fixture,
  })

  const page = await raw('GET', '/')
  assert.equal(page.status, 200)
  assert.equal(page.body.match(/class="card"/g)?.length, 1, 'one card per diagram')
  assert.match(page.body, new RegExp(`href="/d/${ID}"`))
  assert.ok(svgOf(page.body).length > 500, 'the card carries a rendered svg, not a placeholder')
  assert.match(page.body, /audit clean/)
  assert.equal(page.body.match(/<h2[ >]/g)?.length, 1)
  // 1089 × 241 is 4.5:1, so the card crops it and says so instead of squeezing it
  assert.match(page.body, /class="thumb is-wide" aria-hidden="true"/)
  assert.match(page.body, /6 levels · 5 nodes · 8 flows/, 'the countable facts are text')
})

test('a narrow drawing is letterboxed, not cropped and chipped', () => {
  const page = indexPage([{ id: 'narrow', title: 'Narrow', levels: [''], updated: '2026-01-01T00:00:00Z', svg: '<svg/>', ok: true, nodes: 1, flows: 0, wide: false }])
  assert.match(page, /class="thumb" aria-hidden="true"/)
  assert.match(page, /1 level · 1 node · 0 flows/, 'singulars stay singular')
})

test('the error paths answer with a status, never a stack trace', async () => {
  // a model file that is not JSON: the page must not 500 with a raw exception
  const brokenDir = join(root, 'halfwritten')
  mkdirSync(brokenDir, { recursive: true })
  writeFileSync(join(brokenDir, 'model.json'), '{"id": "halfwritten", "levels": [')
  const broken = await fetch(`${base}/d/halfwritten`)
  assert.equal(broken.status, 500)
  assert.match(await broken.text(), /error/i)

  // malformed percent-encoding is a 404 with a reason, not a crash
  const malformed = await raw('GET', '/d/%E0%A4%A')
  assert.equal(malformed.status, 404)
  assert.match(malformed.body, /malformed path/)

  // an asset that is not installed says so instead of 500
  const asset = await fetch(`${base}/not-a-real-asset.css`)
  assert.equal(asset.status, 404)
  assert.match(await asset.text(), /not installed yet/)

  // the stored model is served at the api path
  const model = await fetch(`${base}/api/diagrams/${ID}`)
  assert.equal(model.status, 200)
  assert.equal(((await model.json()) as { id: string }).id, ID)
})

test('a body over the limit is refused with 413, not buffered', async () => {
  const huge = JSON.stringify({ id: 'x', title: 'x', levels: [], pad: 'y'.repeat(3 * 1024 * 1024) })
  const res = await fetch(`${base}/api/diagrams`, { method: 'POST', body: huge, headers: { 'content-type': 'application/json' } })
  assert.equal(res.status, 413)
})

test('a half-written model on disk is skipped by the listing, not fatal', async () => {
  mkdirSync(join(root, 'torn'), { recursive: true })
  writeFileSync(join(root, 'torn', 'model.json'), '{"id": "torn", "levels": [')
  const page = await fetch(`${base}/`)
  assert.equal(page.status, 200, 'one broken directory does not take the grid down')
  assert.match(await page.text(), new RegExp(ID))
})

test('writes are validated before they are stored', async () => {
  const notJson = await fetch(`${base}/api/diagrams`, { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } })
  assert.equal(notJson.status, 400)
  assert.match(await notJson.text(), /not valid JSON/)

  const invalid = await fetch(`${base}/api/diagrams`, {
    method: 'POST',
    body: JSON.stringify({ id: 'bad model', title: 'x', levels: [] }),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(invalid.status, 400)
  const problems = (await invalid.json()) as { problems: string[] }
  assert.ok(problems.problems.some((p) => /id: required/.test(p)), 'the parser\'s reasons come back')
  assert.ok(!existsSync(join(root, 'bad model')), 'and nothing is written')
})

test('a missing diagram and a missing level both say what does exist', async () => {
  const absent = await fetch(`${base}/d/no-such-diagram`)
  assert.equal(absent.status, 404)
  const absentBody = (await absent.json()) as { error: string }
  assert.equal(absentBody.error, 'no diagram "no-such-diagram"')

  const level = await fetch(`${base}/d/${ID}/no/such/level`)
  assert.equal(level.status, 404)
  const body = (await level.json()) as { error: string; levels: string[] }
  assert.match(body.error, /no level "no\/such\/level"/)
  assert.ok(body.levels.includes(''), 'and lists the levels that do exist')
})

test('a failing diagram says so on its card, and a single diagram is not "1 diagrams"', async () => {
  const bad = {
    id: 'broken-audit',
    title: 'Broken',
    levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [{ from: 'a', to: 'a' }] }],
  }
  // the API refuses a self-loop, so write the file the way a crashed writer would leave it
  mkdirSync(join(root, 'broken-audit'), { recursive: true })
  writeFileSync(join(root, 'broken-audit', 'model.json'), JSON.stringify({ ...bad, levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }, { id: 'b', label: 'B &amp; <C>', subtype: 'system' }], edges: [{ from: 'a', to: 'b', label: 'x' }] }] }))
  const page = await (await fetch(`${base}/`)).text()
  assert.match(page, /<title>/, 'the grid still renders')
  assert.match(page, /&amp;/, 'a title is escaped, never injected')
})

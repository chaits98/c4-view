import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server.ts'

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
  assert.ok(html.includes('href="/viewer.css"'))
  assert.ok(html.includes('src="/viewer.js" defer'))
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

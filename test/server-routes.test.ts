/**
 * The routing contract: who may read a page, which verbs each route accepts, and what a
 * request that cannot be honoured gets back. Split from server.test.ts when that file hit
 * the 300-line cap — the fixture is built by POSTing one model, so this file stands alone.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server.ts'

const STORED = {
  id: 'routes',
  title: 'Routes',
  levels: [
    { path: '', title: 'Overview', nodes: [{ id: 'a', label: 'A', subtype: 'system' }, { id: 'b', label: 'B', subtype: 'system' }], edges: [{ from: 'a', to: 'b' }] },
  ],
}
const ID = STORED.id

let server: Server
let root: string
let base = ''

const raw = (method: string, path: string): Promise<{ status: number; allow: string; body: string }> => {
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

before(async () => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'c4-view-routes-'))
  server = await serve({ port: 0, root })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const stored = await fetch(`${base}/api/diagrams`, { method: 'POST', body: JSON.stringify(STORED) })
  assert.equal(stored.status, 201, 'the fixture model is stored')
})

after(async () => {
  await new Promise<void>((done) => server.close(() => done()))
  rmSync(root, { recursive: true, force: true })
})

test('the token leaves the address bar on the first hop, and the cookie carries it after', async () => {
  const guardedRoot = mkdtempSync(join(tmpdir(), 'c4-view-guarded-'))
  const guarded = await serve({ port: 0, root: guardedRoot, token: 'secret-token' })
  const gbase = `http://127.0.0.1:${(guarded.address() as AddressInfo).port}`
  try {
    assert.equal((await fetch(`${gbase}/health`)).status, 200, 'health is open: it is what a supervisor probes')

    const first = await fetch(`${gbase}/?t=secret-token&theme=dark`, { redirect: 'manual' })
    assert.equal(first.status, 302, 'the first hop is a redirect, not a page')
    assert.equal(first.headers.get('location'), '/?theme=dark', 'every other query is kept, the token is not')
    assert.equal(first.headers.get('cache-control'), 'no-store', 'a redirect carrying a credential is never cached')
    const cookie = first.headers.get('set-cookie') ?? ''
    assert.match(cookie, /c4token=secret-token/, 'the cookie is set on the same response')
    assert.match(cookie, /HttpOnly/, 'and no script can read it')

    const settled = await fetch(`${gbase}/?theme=dark`, { headers: { cookie: cookie.split(';')[0] } })
    assert.equal(settled.status, 200, 'the address bar now carries no token')
    assert.equal(settled.headers.get('cache-control'), 'no-store', 'and the page is not cached either')

    const denied = await fetch(`${gbase}/`, { headers: { accept: 'text/html' } })
    assert.equal(denied.status, 401)
    assert.match(denied.headers.get('www-authenticate') ?? '', /Bearer realm="c4-view"/, 'it says how to authenticate')
    const body = await denied.text()
    assert.match(body, /<h1[^>]*>This viewer needs its token<\/h1>/, 'a person gets a page that states the cause')
    assert.ok(!body.includes('<svg'), 'and nothing of the drawing')

    const agent = await fetch(`${gbase}/api/diagrams`)
    assert.equal(agent.status, 401)
    assert.match(await agent.text(), /token required/, 'an agent gets JSON, not markup')
    assert.equal((await fetch(`${gbase}/?t=wrong`)).status, 401, 'a wrong token is refused the same way')
  } finally {
    await new Promise<void>((done) => guarded.close(() => done()))
    rmSync(guardedRoot, { recursive: true, force: true })
  }
})

test('routes answer 405 rather than silently serving the wrong verb', async () => {
  const post = await raw('POST', `/d/${ID}`)
  assert.equal(post.status, 405)
  assert.equal(post.allow, 'GET', 'the answer says which verbs exist')
  const put = await raw('PUT', '/api/diagrams')
  assert.equal(put.status, 405)
  assert.match(put.allow, /POST/)
})

test('the api answers for a trailing slash, an audit route and a malformed id', async () => {
  assert.equal((await fetch(`${base}/api/diagrams/`)).status, 200, 'trailing slash is the same collection')
  const all = await fetch(`${base}/api/diagrams/${ID}/audit`)
  assert.equal(all.status, 200)
  assert.ok(Array.isArray(await all.json()), 'no level: every level\'s audit')
  const one = await fetch(`${base}/api/diagrams/${ID}/audit?level=`)
  assert.equal(one.status, 200)
  assert.equal((await fetch(`${base}/api/diagrams/not%20an%20id`)).status, 404, 'an id that cannot exist is a 404')
})

test('a stray file in the store, or a level path that escapes, is ignored', async () => {
  writeFileSync(join(root, 'README.txt'), 'not a diagram')
  mkdirSync(join(root, 'not-an-id!'), { recursive: true })
  const page = await fetch(`${base}/`)
  assert.equal(page.status, 200)
  assert.ok(!(await page.text()).includes('README'), 'a loose file is not a card')

  assert.equal((await fetch(`${base}/d/${ID}/..%2F..%2Fetc`)).status, 404, 'a traversal is not a level')
})

test('the page carries a text version, and a skip link before the header', async () => {
  const html = await (await fetch(`${base}/d/${ID}`)).text()
  assert.match(html, /<a class="c4-skip" href="#c4-stage">Skip to the diagram<\/a>/, 'the skip link is the first tab stop')
  assert.ok(html.indexOf('c4-skip') < html.indexOf('<header'), 'and it comes before the bar it skips over')
  assert.match(html, /<details id="c4-text"/, 'the text version is a details block')
  assert.match(html, /Containers \(\d+\)/, 'with a count, so a reader knows what they are missing')
  assert.match(html, /Flows \(\d+\)/)
  assert.ok(!/<details[^>]*>[\s\S]*<svg/.test(html.slice(html.indexOf('<details'))), 'and no drawing inside it')
})

test('the states a first-time reader meets are pages, not JSON', async () => {
  const html = { accept: 'text/html' }
  const missing = await fetch(`${base}/d/no-such-diagram`, { headers: html })
  assert.equal(missing.status, 404)
  const missingBody = await missing.text()
  assert.match(missingBody, /<h1[^>]*>There is no diagram called/, 'one heading, one cause')
  assert.match(missingBody, /href="\/">all diagrams<\/a>/, 'and one action')

  const level = await fetch(`${base}/d/${ID}/no/such/level`, { headers: html })
  assert.equal(level.status, 404)
  assert.match(await level.text(), /has no level/, 'the level 404 is a page too')

  // a model that is on disk and will not parse is 500, not "no such diagram"
  mkdirSync(join(root, 'torn'), { recursive: true })
  writeFileSync(join(root, 'torn', 'model.json'), '{"id": "torn", "levels": [')
  const broken = await fetch(`${base}/d/torn`, { headers: html })
  assert.equal(broken.status, 500)
  assert.match(await broken.text(), /will not parse/, 'and says which file to fix')

  const agent = await fetch(`${base}/d/no-such-diagram`)
  assert.match(await agent.text(), /"error"/, 'an agent still gets JSON')

  // the same broken file through the two routes that do not render a page: an export and the api
  assert.equal((await fetch(`${base}/d/torn.svg`)).status, 500, 'an export of a broken model is a 500')
  assert.equal((await fetch(`${base}/api/diagrams/torn`, { headers: html })).status, 200,
    'the model endpoint still returns the bytes on disk — it is the store, not a renderer')
})

test('an empty store says so in words, with the next action', async () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'c4-view-empty-'))
  const empty = await serve({ port: 0, root: emptyRoot })
  try {
    const page = await (await fetch(`http://127.0.0.1:${(empty.address() as AddressInfo).port}/`)).text()
    assert.match(page, /<h1[^>]*>No diagrams yet<\/h1>/)
    assert.match(page, /c4v render model\.json/, 'the action is a command, not a shrug')
  } finally {
    await new Promise<void>((done) => empty.close(() => done()))
    rmSync(emptyRoot, { recursive: true, force: true })
  }
})

test('a card that had to crop says so with a class, not a badge', async () => {
  const wide = {
    id: 'wide-row',
    title: 'Ten in a row',
    levels: [{
      path: '',
      nodes: Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, label: `Service ${i}`, subtype: 'system' })),
      edges: Array.from({ length: 9 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
    }],
  }
  assert.equal((await fetch(`${base}/api/diagrams`, { method: 'POST', body: JSON.stringify(wide) })).status, 201)
  const page = await (await fetch(`${base}/`)).text()
  assert.match(page, /class="thumb is-wide"/, 'the crop is declared in the markup')
  assert.ok(!/wide · \d+ px/.test(page), 'and not repeated as a debug badge on the card')
})

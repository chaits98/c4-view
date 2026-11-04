/**
 * The routing contract: who may read a page, which verbs each route accepts, and what a
 * request that cannot be honoured gets back. Split from server.test.ts when that file hit
 * the 300-line cap — the fixture is built by POSTing one model, so this file stands alone.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server.ts'
import { findChromium } from '../src/png.ts'
/** A machine without a browser cannot rasterise; those tests are skipped, not failed. */
const noBrowser = findChromium() ? false : 'no Chromium on this machine'

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
  // anchored at the text block: the download menu is a `<details>` too, and it comes first
  assert.ok(!/<svg/.test(html.slice(html.indexOf('<details id="c4-text"'), html.indexOf('</details>', html.indexOf('<details id="c4-text"')))), 'and no drawing inside it')
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

test('every route shape answers in its own content type', async () => {
  const nested = {
    id: 'nested',
    title: 'Nested',
    levels: [
      { path: '', title: 'Overview', nodes: [{ id: 'app', label: 'App', subtype: 'system' }], edges: [] },
      { path: 'app', title: 'App', nodes: [{ id: 'svc', label: 'Svc', subtype: 'system' }], edges: [] },
      { path: 'app/db', title: 'Db', nodes: [{ id: 'tbl', label: 'Tbl', subtype: 'database' }], edges: [] },
    ],
  }
  assert.equal((await fetch(`${base}/api/diagrams`, { method: 'POST', body: JSON.stringify(nested) })).status, 201)

  const css = await fetch(`${base}/tokens.css`)
  assert.equal(css.status, 200)
  assert.match(css.headers.get('content-type') ?? '', /^text\/css/, 'a stylesheet is text/css')

  const js = await fetch(`${base}/viewer.js`)
  assert.equal(js.status, 200)
  assert.match(js.headers.get('content-type') ?? '', /^text\/javascript/, 'a script is javascript')

  const svg = await fetch(`${base}/d/nested.svg`)
  assert.equal(svg.status, 200)
  assert.match(svg.headers.get('content-type') ?? '', /^image\/svg/, 'the export is image/svg+xml')
  assert.match(await svg.text(), /^<svg/, 'and it is an svg')

  const deep = await fetch(`${base}/d/nested/app/db`)
  assert.equal(deep.status, 200, 'a multi-segment level is one page')
  assert.match(await deep.text(), /<a role="menuitem" href="[^"]*\/app\/db" title="app\/db" aria-current="true">/, 'and the level control knows it')

  const audit = await fetch(`${base}/api/diagrams/nested/audit?level=app`)
  assert.equal(audit.status, 200)
  const one = (await audit.json()) as { ok: boolean }
  assert.equal(one.ok, true, 'the audit of one level is an object, not a list')

  const all = await fetch(`${base}/api/diagrams/nested/audit`)
  assert.ok(Array.isArray(await all.json()), 'and every level is a list')
})

test('a client that hangs up mid-upload gets no answer and takes nothing down', async () => {
  const url = new URL(base)
  // a POST that promises a body, sends half of it, then drops the socket
  await new Promise<void>((done) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(
        `POST /api/diagrams HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"id": "half`,
      )
      setTimeout(() => { socket.destroy(); done() }, 60)
    })
    socket.on('error', () => done())
  })
  // the server is still answering: the aborted read closed one request, not the process
  assert.equal((await fetch(`${base}/health`)).status, 200)
  assert.equal((await fetch(`${base}/api/diagrams/${ID}`)).status, 200)
})

test('a store the process cannot read is a 500, and the server keeps serving', async () => {
  const lockedRoot = mkdtempSync(join(tmpdir(), 'c4-view-locked-'))
  const locked = await serve({ port: 0, root: join(lockedRoot, 'store') })
  mkdirSync(join(lockedRoot, 'store'), { recursive: true })
  const lbase = `http://127.0.0.1:${(locked.address() as AddressInfo).port}`
  try {
    chmodSync(join(lockedRoot, 'store'), 0o000)
    const refused = await fetch(`${lbase}/`)
    assert.equal(refused.status, 500, 'an unreadable store is the server\'s fault, not a 404')
    assert.match(await refused.text(), /"error"/, 'and it says so in JSON, because no diagram was named')
  } finally {
    chmodSync(join(lockedRoot, 'store'), 0o755)
    await new Promise<void>((done) => locked.close(() => done()))
    rmSync(lockedRoot, { recursive: true, force: true })
  }
})

test('a directory that looks like a diagram but has no model is not a diagram', async () => {
  mkdirSync(join(root, 'empty-dir'), { recursive: true })
  const page = await fetch(`${base}/`)
  assert.equal(page.status, 200)
  assert.ok(!(await page.text()).includes('empty-dir'), 'an empty directory is skipped by the grid')
  assert.equal((await fetch(`${base}/d/empty-dir`)).status, 404, 'and asking for it is a 404, not a crash')
})

test('the png export answers with an image, and reuses the file it already rendered', { skip: noBrowser }, async () => {
  const first = await fetch(`${base}/d/${ID}.png`)
  assert.equal(first.status, 200, 'a png is produced on demand')
  assert.match(first.headers.get('content-type') ?? '', /^image\/png/)
  const bytes = (await first.arrayBuffer()).byteLength
  assert.ok(bytes > 0, 'and it has pixels in it')
  const second = await fetch(`${base}/d/${ID}.png`)
  assert.equal(second.status, 200, 'the second request hits the cache')
  assert.equal((await second.arrayBuffer()).byteLength, bytes, 'with the same bytes')
})

test('a post with no body at all is a 400, not a hang', async () => {
  const res = await fetch(`${base}/api/diagrams`, { method: 'POST', body: '' })
  assert.equal(res.status, 400)
  assert.match(await res.text(), /not valid JSON|problems/, 'and it says why')
})

test('a token in the environment guards the server even when none is passed', async () => {
  const saved = process.env.C4_VIEW_TOKEN
  process.env.C4_VIEW_TOKEN = 'from-env'
  const envRoot = mkdtempSync(join(tmpdir(), 'c4-view-env-'))
  const envServer = await serve({ port: 0, root: envRoot, host: '0.0.0.0' })
  const ebase = `http://127.0.0.1:${(envServer.address() as AddressInfo).port}`
  try {
    assert.equal((await fetch(`${ebase}/`)).status, 401, 'the environment token is the guard')
    assert.equal((await fetch(`${ebase}/?t=from-env`, { redirect: 'manual' })).status, 302, 'and it works like any other')
  } finally {
    if (saved === undefined) delete process.env.C4_VIEW_TOKEN
    else process.env.C4_VIEW_TOKEN = saved
    await new Promise<void>((done) => envServer.close(() => done()))
    rmSync(envRoot, { recursive: true, force: true })
  }
})

test('a chunked body with no content-length is still measured', async () => {
  // a stream body has no Content-Length, so the ceiling has to be enforced while reading
  const chunk = new Uint8Array(64 * 1024).fill(121)
  let sent = 0
  const body = new ReadableStream({
    pull(controller) {
      if (sent >= 4 * 1024 * 1024) return controller.close()
      sent += chunk.length
      controller.enqueue(chunk)
    },
  })
  // the server answers 413 and closes the connection while the client is still writing, so the
  // client may see the status or a reset — either way the write was refused, not buffered
  let outcome: number | 'reset' = 0
  try {
    outcome = (await fetch(`${base}/api/diagrams`, { method: 'POST', body, duplex: 'half' } as RequestInit)).status
  } catch {
    outcome = 'reset'
  }
  assert.ok(outcome === 413 || outcome === 'reset', `refused mid-stream: ${outcome}`)
  assert.equal((await fetch(`${base}/health`)).status, 200, 'and the server is still there afterwards')
})

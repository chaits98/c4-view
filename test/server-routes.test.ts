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

/**
 * The guard: loopback needs nothing, a real interface needs a token, and every response carries the
 * headers that stop the browser-side tricks. These tests exist because "it is only local" is exactly
 * the sentence that precedes an open viewer on a coffee-shop LAN.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { guardNotice, type Guard } from '../src/security.ts'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowed, applyHeaders, guardFor, presented } from '../src/security.ts'
import { serve } from '../src/server.ts'

const host = (headers: Record<string, string>, url = '/') => {
  const req = { headers } as unknown as Parameters<typeof presented>[0]
  return { req, url: new URL(`http://x${url}`) }
}

test('loopback gets no token; a real interface always does', () => {
  assert.equal(guardFor('127.0.0.1').token, null)
  assert.equal(guardFor('localhost').token, null)
  const open = guardFor('0.0.0.0')
  assert.ok(open.token && open.generated, 'a shared bind must generate a token')
  const pinned = guardFor('0.0.0.0', 'given-token')
  assert.equal(pinned.token, 'given-token')
  assert.equal(pinned.generated, false)
})

test('bearer, ?t= and cookie all authenticate; a wrong token does not', () => {
  const guard = guardFor('0.0.0.0', 'secret-token')
  assert.equal(allowed(guard, ...Object.values(host({ authorization: 'Bearer secret-token' })) as [never, URL]), true)
  assert.equal(allowed(guard, ...Object.values(host({}, '/?t=secret-token')) as [never, URL]), true)
  assert.equal(allowed(guard, ...Object.values(host({ cookie: 'c4token=secret-token' })) as [never, URL]), true)
  assert.equal(allowed(guard, ...Object.values(host({ authorization: 'Bearer nope' })) as [never, URL]), false)
  assert.equal(allowed(guard, ...Object.values(host({})) as [never, URL]), false)
})

test('every response carries CSP, nosniff and no framing', () => {
  const res = { headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v } }
  applyHeaders(res as unknown as Parameters<typeof applyHeaders>[0])
  assert.match(res.headers['Content-Security-Policy'], /script-src 'self'/)
  assert.match(res.headers['Content-Security-Policy'], /style-src 'self'(;|$)/)
  assert.doesNotMatch(res.headers['Content-Security-Policy'], /unsafe-inline/, 'nothing inline to allow')
  assert.match(res.headers['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
})

/** Minimal GET that keeps the raw response so headers can be asserted. */
function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers as Record<string, unknown>, body }))
    })
    req.on('error', fail)
    req.end()
  })
}

test('a shared server refuses anonymous page requests and lets a token through', async () => {
  const root = mkdtempSync(join(tmpdir(), 'c4v-guard-'))
  mkdirSync(join(root, 'demo'), { recursive: true })
  writeFileSync(
    join(root, 'demo', 'model.json'),
    JSON.stringify({ id: 'demo', title: 'Demo', levels: [{ path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system', state: 'built' as const }], edges: [] }] }),
  )
  const server = await serve({ port: 0, root, host: '0.0.0.0', token: 'tok' })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    const anon = await get(port, '/')
    assert.equal(anon.status, 401)
    assert.match(String(anon.headers['www-authenticate']), /Bearer/)
    const health = await get(port, '/health')
    assert.equal(health.status, 200, '/health stays open for supervisors')
    // the token in the URL is traded for a cookie and a redirect, so it never stays in the address bar
    const withToken = await get(port, '/?t=tok')
    assert.equal(withToken.status, 302)
    assert.equal(withToken.headers.location, '/')
    assert.match(String(withToken.headers['set-cookie']), /c4token=tok; HttpOnly; SameSite=Strict/)
    assert.equal(withToken.headers['cache-control'], 'no-store')
    assert.match(String(withToken.headers['content-security-policy']), /frame-ancestors 'none'/)
    const viaCookie = await get(port, '/', { cookie: 'c4token=tok' })
    assert.equal(viaCookie.status, 200)
  } finally {
    server.close()
  }
})

test('the startup notice says whether the box is on the network, and with what token', () => {
  const local = guardNotice({ token: null, host: '127.0.0.1', generated: false } as unknown as Guard, 8788)
  assert.deepEqual(local, ['serving http://127.0.0.1:8788/ — local only'])

  const shared = guardNotice({ token: 'abc', host: '0.0.0.0', generated: true } as unknown as Guard, 8788, true)
  assert.match(shared[0], /http:\/\/<this-host>:8788\/ — shared on the network, token required/, 'no real hostname leaked')
  assert.match(shared[1], /generated this run; pass --token to pin it/)

  const pinned = guardNotice({ token: 'abc', host: '10.0.0.5', generated: false } as unknown as Guard, '8788', true)
  assert.match(pinned[0], /http:\/\/10\.0\.0\.5:8788\//)
  assert.ok(!pinned[1].includes('generated this run'), 'a pinned token is not described as generated')
  assert.ok(pinned.some((line) => line.includes('?t=abc')), 'the one-click url is shown')
})

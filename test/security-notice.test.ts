/** The startup notice: what a person needs, and what a log file must never contain. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardNotice } from '../src/security.ts'

test('the token is printed to a terminal and never to a log', () => {
  const guard = { token: 's3cret-token', host: '0.0.0.0', generated: false }
  assert.ok(guardNotice(guard, 8788, true).join('\n').includes('s3cret-token'), 'a human at a terminal gets it')
  const logged = guardNotice(guard, 8788, false).join('\n')
  assert.ok(!logged.includes('s3cret-token'), 'a log does not')
  assert.match(logged, /not printed: stdout is not a terminal/)
  assert.match(logged, /\?t=<token>/, 'and the shape of the URL is still there')
})

test('the one-click link is remembered in a 0600 file, so no log has to carry it', async () => {
  const { mkdtempSync, statSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { rememberOpenUrl, openUrlPath } = await import('../src/security.ts')
  const home = mkdtempSync(join(tmpdir(), 'c4v-open-'))
  assert.equal(rememberOpenUrl({ token: null, host: '0.0.0.0', generated: false } as never, 8788, home), null, 'no token, no file')
  const line = rememberOpenUrl({ token: 'tok', host: '0.0.0.0', generated: false } as never, 8788, home, 'r9-pc')
  assert.match(line ?? '', /open:/)
  const file = openUrlPath(home)
  assert.equal(statSync(file).mode & 0o777, 0o600, 'nobody else may read it')
  assert.deepEqual(
    readFileSync(file, 'utf8').trim().split('\n'),
    ['http://localhost:8788/?t=tok', 'http://r9-pc:8788/?t=tok'],
    'two names: this box, and the network',
  )
})

test('a named host keeps its own name in the remembered link', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { rememberOpenUrl, openUrlPath } = await import('../src/security.ts')
  const home = mkdtempSync(join(tmpdir(), 'c4v-open2-'))
  rememberOpenUrl({ token: 't2', host: '10.0.0.5', generated: false } as never, '8788', home)
  assert.equal(readFileSync(openUrlPath(home), 'utf8').trim(), 'http://10.0.0.5:8788/?t=t2')
})

test('a cookie left over from a rotated token is replaced, not kept forever', async () => {
  const { remember } = await import('../src/security.ts')
  const reply = (): { headers: Record<string, string>; setHeader: (k: string, v: string) => void } => {
    const headers: Record<string, string> = {}
    return { headers, setHeader: (k, v) => { headers[k.toLowerCase()] = v } }
  }
  const guard = { token: 'new-token', host: '0.0.0.0', generated: false }
  const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as never
  const url = (t?: string) => new URL(`http://h:8788/${t ? `?t=${t}` : ''}`)

  const stale = reply()
  remember(guard as never, req('c4token=old-token'), url('new-token'), stale as never)
  assert.match(stale.headers['set-cookie'] ?? '', /c4token=new-token/, 'the old cookie is replaced on the first good visit')

  const same = reply()
  remember(guard as never, req('c4token=new-token'), url('new-token'), same as never)
  assert.equal(same.headers['set-cookie'], undefined, 'nothing to rewrite')

  const bearer = reply()
  const withAuth = (auth: string) => ({ headers: { authorization: auth } }) as never
  remember(guard as never, withAuth('Bearer new-token'), url(), bearer as never)
  assert.match(bearer.headers['set-cookie'] ?? '', /c4token=new-token/, 'an agent that sends the header is remembered too')

  const wrong = reply()
  remember(guard as never, req(), url('not-the-token'), wrong as never)
  assert.equal(wrong.headers['set-cookie'], undefined, 'a token that does not check out is never remembered')
})

test('the token is printed to a terminal, and only its location to a log', async () => {
  const { tokenLines } = await import('../src/cli.ts')
  assert.deepEqual(tokenLines(null, true), [], 'no token, no line')
  assert.deepEqual(tokenLines('', true), [], 'an empty token is no token')
  assert.match(tokenLines('abc', true)[0], /token:\s+abc/, 'a human at a terminal gets it')
  const logged = tokenLines('abc', false)[0]
  assert.ok(!logged.includes('abc'), 'a service log does not')
  assert.match(logged, /not printed/)
})

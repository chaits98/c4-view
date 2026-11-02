/** The two ways to read one model: drill, or every level opened at once. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import type { Server } from 'node:http'
import { serve } from '../src/server.ts'
import { save } from '../src/store.ts'
import { parseModel } from '../src/model.ts'

const STORED = parseModel({
  id: 'modes',
  title: 'Modes',
  levels: [
    { path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }, { id: 'box', label: 'Box', subtype: 'system' }], edges: [{ from: 'a', to: 'box' }] },
    { path: 'box', nodes: [{ id: 'in', label: 'In', subtype: 'service-logic' }], edges: [], ports: { 'a->box': 'in' } },
  ],
} as never)

let server: Server
let root = ''
let base = ''

const raw = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const url = new URL(base)
    const req = httpRequest({ hostname: url.hostname, port: url.port, path }, (res: IncomingMessage) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => done(body))
    })
    req.on('error', fail)
    req.end()
  })

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'c4-view-modes-'))
  save(root, STORED.id, JSON.stringify({ id: 'modes', title: 'Modes', levels: STORED.levels }))
  server = await serve({ port: 0, root })
  const addr = server.address()
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/` : ''
})

after(() => { server.close(); rmSync(root, { recursive: true, force: true }) })

test('?view=full serves the whole model as one page, with the mode marked', async () => {
  const drill = await raw(`/d/modes`)
  const full = await raw(`/d/modes?view=full`)
  assert.match(full, /data-view="full" aria-current="true"/)
  assert.match(drill, /data-view="drill" aria-current="true"/)
  assert.notEqual(full.length, drill.length, 'the full page draws more than the overview')
})

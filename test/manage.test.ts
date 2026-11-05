/**
 * The two things a reader does to the grid itself: pin a diagram to the front, delete one.
 *
 * These touch the store, so the tests drive the real HTTP surface against a real directory: a pin that only
 * lives in memory, or a delete that leaves the docs behind, is a promise the grid cannot keep.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pinnedIds, remove, setPinned, list, unreadable } from '../src/store.ts'
import { serve } from '../src/server.ts'
import { indexPage } from '../src/index-page.ts'

/* nodes live inside levels, and a node needs an id, a label and a C4 subtype */
const MODEL = {
  id: 'shop',
  title: 'Shop',
  levels: [
    {
      path: '',
      title: 'Shop',
      nodes: [{ id: 'api', label: 'API', subtype: 'system', state: 'built' as const, desc: 'takes orders' }],
      edges: [],
    },
  ],
}

function store(): string {
  const root = mkdtempSync(join(tmpdir(), 'c4v-manage-'))
  return root
}

function put(root: string, id: string): void {
  mkdirSync(join(root, id), { recursive: true })
  writeFileSync(join(root, id, 'model.json'), JSON.stringify({ ...MODEL, id }))
}

test('a pin is one file, and unpinning leaves an empty list rather than a stale id', () => {
  const root = store()
  put(root, 'shop')
  assert.equal(setPinned(root, 'shop', true), true)
  assert.deepEqual([...pinnedIds(root)], ['shop'])
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.pins.json'), 'utf8')), { pinned: ['shop'] })
  assert.equal(setPinned(root, 'shop', false), false)
  assert.deepEqual([...pinnedIds(root)], [])
  assert.equal(setPinned(root, 'absent', true), false, 'an id that is not stored cannot be pinned')
})

test('a pins file that is missing, corrupt or the wrong shape reads as no pins', () => {
  const root = store()
  assert.equal(pinnedIds(root).size, 0, 'missing')
  writeFileSync(join(root, '.pins.json'), 'not json')
  assert.equal(pinnedIds(root).size, 0, 'corrupt')
  writeFileSync(join(root, '.pins.json'), '{"pinned":"shop"}')
  assert.equal(pinnedIds(root).size, 0, 'wrong shape')
  writeFileSync(join(root, '.pins.json'), '{"pinned":["shop",7,"../etc"]}')
  assert.deepEqual([...pinnedIds(root)], ['shop'], 'only real ids survive')
})

test('list says when a diagram was made and whether it is pinned', () => {
  const root = store()
  put(root, 'shop')
  setPinned(root, 'shop', true)
  const [row] = list(root)
  assert.equal(row.id, 'shop')
  assert.equal(row.pinned, true)
  assert.match(row.created, /^\d{4}-\d{2}-\d{2}T/, 'a real timestamp, not an empty string')
  assert.ok(row.created <= row.updated, 'created is never after updated')
})

test('delete removes the diagram and its pins entry, and refuses anything else', () => {
  const root = store()
  put(root, 'shop')
  setPinned(root, 'shop', true)
  assert.equal(remove(root, 'shop'), true)
  assert.equal(existsSync(join(root, 'shop')), false)
  assert.deepEqual([...pinnedIds(root)], [])
  assert.equal(remove(root, 'shop'), false, 'nothing left to remove')
  assert.equal(remove(root, '../etc'), false, 'an id is never a path')
})

test('the api pins, unpins and deletes, and refuses a body that says nothing', async () => {
  const root = store()
  put(root, 'shop')
  const server = await serve({ port: 0, root, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const pin = await fetch(`${base}/api/diagrams/shop/pin`, { method: 'POST', body: JSON.stringify({ pinned: true }) })
    assert.equal(pin.status, 200)
    assert.deepEqual(await pin.json(), { id: 'shop', pinned: true })

    const wordless = await fetch(`${base}/api/diagrams/shop/pin`, { method: 'POST', body: JSON.stringify({ pinned: 'yes' }) })
    assert.equal(wordless.status, 400, 'a pin is a boolean, not a mood')
    const broken = await fetch(`${base}/api/diagrams/shop/pin`, { method: 'POST', body: 'not json' })
    assert.equal(broken.status, 400)
    const absent = await fetch(`${base}/api/diagrams/nope/pin`, { method: 'POST', body: JSON.stringify({ pinned: true }) })
    assert.equal(absent.status, 404)

    const del = await fetch(`${base}/api/diagrams/shop`, { method: 'DELETE' })
    assert.equal(del.status, 200)
    const gone = await fetch(`${base}/api/diagrams/shop`, { method: 'DELETE' })
    assert.equal(gone.status, 404)
  } finally {
    server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a mutation from another origin is refused; curl, which sends none, is not', async () => {
  const root = store()
  put(root, 'shop')
  const server = await serve({ port: 0, root, host: '127.0.0.1' })
  const port = (server.address() as { port: number }).port
  try {
    const cross = await fetch(`http://127.0.0.1:${port}/api/diagrams/shop/pin`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Host: `127.0.0.1:${port}` },
      body: JSON.stringify({ pinned: true }),
    })
    assert.equal(cross.status, 403, 'a borrowed cookie is not consent')
    const same = await fetch(`http://127.0.0.1:${port}/api/diagrams/shop/pin`, {
      method: 'POST',
      headers: { Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ pinned: true }),
    })
    assert.equal(same.status, 200)
    // a sandboxed iframe and a file:// page both send the literal origin "null": it is not our host
    const opaque = await fetch(`http://127.0.0.1:${port}/api/diagrams/shop/pin`, {
      method: 'POST',
      headers: { Origin: 'null' },
      body: JSON.stringify({ pinned: false }),
    })
    assert.equal(opaque.status, 403, 'an origin that cannot be parsed is not this origin')
    const get = await fetch(`http://127.0.0.1:${port}/api/diagrams/shop`, { method: 'PUT' })
    assert.equal(get.status, 405, 'the model endpoint takes GET and DELETE, nothing else')
  } finally {
    server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a store that is absent reads as nothing unreadable, and broken JSON is not a rule problem', () => {
  assert.deepEqual(unreadable(join(store(), 'no-such-store')), [], 'no store, nothing to report')
  const r = store()
  mkdirSync(join(r, 'junk'), { recursive: true })
  writeFileSync(join(r, 'junk', 'model.json'), '{not json')
  assert.equal(unreadable(r)[0]?.id, 'junk')
  rmSync(r, { recursive: true, force: true })
})

test('a stored diagram the current rules refuse is named on the page, not hidden', async () => {
  const root = store()
  put(root, 'shop')
  // a model the current rules refuse: an edge to a node that does not exist
  mkdirSync(join(root, 'old'), { recursive: true })
  writeFileSync(join(root, 'old', 'model.json'), JSON.stringify({
    ...MODEL,
    id: 'old',
    levels: [{ ...MODEL.levels[0], edges: [{ from: 'api', to: 'ghost', desc: 'x' }] }],
  }))
  assert.deepEqual(unreadable(root).map((b) => b.id), ['old'], 'only the out-of-date one')
  assert.match(unreadable(root)[0].reason, /unknown node/)
  const server = await serve({ port: 0, root, host: '127.0.0.1' })
  const port = (server.address() as { port: number }).port
  try {
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text()
    assert.match(page, /class="idx-note"/, 'the grid says so')
    assert.match(page, /<code>old<\/code>/, 'by id')
    assert.match(page, /unknown node/, 'with the reason')
    assert.match(page, /href="\/d\/shop"/, 'and still draws the one that is valid')
  } finally {
    server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the card states its dates and says Pinned in words, not only in colour', () => {
  const base = {
    id: 'shop',
    title: 'Shop',
    levels: [''],
    created: '2026-11-01T10:00:00.000Z',
    updated: '2026-11-04T10:00:00.000Z',
    pinned: true,
    svg: '<svg viewBox="0 0 10 10"></svg>',
    ok: true,
    nodes: 1,
    flows: 0,
    wide: false,
  }
  const html = indexPage([base])
  assert.match(html, /created 2026-11-01 · updated 2026-11-04/)
  assert.match(html, /class="badge pinned t-label-m"/, 'pinned is a chip')
  assert.match(html, /aria-pressed="true"[\s\S]*?Unpin/, 'and the menu offers the way out of it')
  const fresh = indexPage([{ ...base, pinned: false, created: '2026-11-04T10:00:00.000Z' }])
  assert.match(fresh, /updated 2026-11-04/, 'one date when both agree')
  assert.ok(!fresh.includes('created 2026-11-04'), 'and no repeated pair')
})

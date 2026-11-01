/**
 * The grid: what a card says, how the grid is ordered, and what it says when there is nothing to
 * show. Split from the routing tests when that file hit the 300-line cap — the fixture is built by
 * POSTing models, so this file stands alone.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server.ts'

const model = (id: string, title: string, count: number): Record<string, unknown> => ({
  id,
  title,
  levels: [{
    path: '',
    nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Service ${i}`, subtype: 'system' })),
    edges: Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
  }],
})

let server: ReturnType<typeof serve> extends Promise<infer T> ? T : never
let root = ''
let base = ''

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'c4-view-grid-'))
  server = await serve({ port: 0, root })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  for (const [id, title, count] of [['alpha', 'Alpha', 2], ['zulu', 'Zulu', 3], ['ten-in-a-row', 'Ten', 10], ['huge', 'Huge', 401]] as Array<[string, string, number]>) {
    await fetch(`${base}/api/diagrams`, { method: 'POST', body: JSON.stringify(model(id, title, count)) })
  }
})

after(async () => {
  await new Promise<void>((done) => server.close(() => done()))
  rmSync(root, { recursive: true, force: true })
})

test('sort and filter are links that survive a reload, and the state is text', async () => {
  const byTitle = await (await fetch(`${base}/?sort=title`)).text()
  assert.match(byTitle, /<a class="idx-sort" href="\/\?sort=title"[^>]*aria-current="true"/, 'the current sort is marked')
  assert.match(byTitle, /newest/, 'and the default is labelled in words')

  const failing = await (await fetch(`${base}/?audit=fail`)).text()
  assert.match(failing, />showing failures</, 'the filter says what it is doing')
  if (!failing.includes('class="card"')) {
    assert.match(failing, /Nothing is failing/, 'an empty filter says so, instead of claiming the store is empty')
    assert.ok(!failing.includes('No diagrams yet'), 'and never claims there are no diagrams')
  }

  const names = [...byTitle.matchAll(/<h2 class="t-title-m">([^<]+)<\/h2>/g)].map((m) => m[1])
  assert.deepEqual(names, [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())), 'title order is alphabetical')

  const auditSorted = [...(await (await fetch(`${base}/?sort=audit`)).text()).matchAll(/<h2 class="t-title-m">([^<]+)<\/h2>/g)].map((m) => m[1])
  assert.ok(auditSorted.length >= 1, 'audit sort renders cards')

  assert.match(byTitle, /href="\/\?sort=title&amp;audit=fail"/, 'the sort link keeps the filter')
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

test('a card too heavy to inline draws a placeholder, and the grid keeps its frame', async () => {
  const page = await (await fetch(`${base}/`)).text()
  const cardOf = (id: string): string => {
    const at = page.indexOf(`href="/d/${id}"`)
    return page.slice(at, page.indexOf('</a>', at))
  }
  assert.match(cardOf('huge'), /is-placeholder/, '401 nodes is too many to inline')
  assert.ok(!cardOf('huge').includes('<svg'), 'so no drawing is inlined')
  assert.match(cardOf('alpha'), /<svg/, 'a small card still shows its drawing')

  const started = performance.now()
  await fetch(`${base}/`)
  const elapsed = performance.now() - started
  assert.ok(elapsed < 250, `the grid with a 401-node diagram answers in ${Math.round(elapsed)}ms`)
})

test('the audit banner names what failed, three at most, then counts the rest', async () => {
  const { auditBanner } = await import('../src/viewer-page.ts')
  const report = { level: '', nodes: 2, edges: 1, nodeNode: 0, wireNode: 0, wireWire: 0, crossings: 0, backward: 0, chipChip: 0, chipNode: 0, groupNode: 0, ok: true, aspect: 1 }
  assert.equal(auditBanner(report), '', 'a clean drawing has no banner')

  const one = auditBanner({ ...report, ok: false, nodeNode: 2 })
  assert.match(one, /two containers overlap \(2\)/, 'a failing gate is named, with its count')
  assert.match(one, /role="status"/, 'and it is announced, not just painted')

  const many = auditBanner({ ...report, ok: false, nodeNode: 1, wireNode: 1, wireWire: 1, chipNode: 1, chipChip: 1 })
  assert.match(many, /and 2 more checks/, 'five failures print three and a count')
  assert.equal((many.match(/<li>/g) ?? []).length, 4, 'three names plus the count')
})

test('four failing gates print three names and "and 1 more check"', async () => {
  const { auditBanner } = await import('../src/viewer-page.ts')
  const report = { level: '', nodes: 2, edges: 1, nodeNode: 1, wireNode: 1, wireWire: 1, crossings: 0, backward: 0, chipChip: 1, chipNode: 0, groupNode: 0, ok: false, aspect: 1 }
  const html = auditBanner(report)
  assert.match(html, /and 1 more check<\/li>/, 'singular, not "checks"')
  assert.equal((html.match(/<li>/g) ?? []).length, 4)
})

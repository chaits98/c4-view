/**
 * A node may point at its own documentation (a wiki page, a runbook). The link is drawn as a chip,
 * and only http(s) is allowed — a `javascript:` href would be a live link on every page the diagram
 * is served on. Both halves are asserted here: the anchor that ships, and the scheme that refuses.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModel, ModelError } from '../src/model.ts'
import { renderModel } from '../src/render.ts'

const model = (href: string) => ({
  id: 'links',
  title: 'links',
  levels: [{
    path: '',
    nodes: [{ id: 'a', label: 'Alpha', subtype: 'system', state: 'built' as const, links: [{ label: 'Confluence: ADR-14', href }] }],
    edges: [],
    flow: [],
  }],
})

test('an http link is drawn as its own anchor, with target and rel', () => {
  const parsed = parseModel(model('https://confluence.example.com/x/ADR-14'))
  const svg = renderModel(parsed, '', undefined, undefined, true).levels[0].svg
  const anchor = /<a class="c4-ext" href="([^"]+)" target="_blank" rel="noopener noreferrer"/.exec(svg)
  assert.ok(anchor, 'the chip anchor is missing from the svg')
  assert.equal(anchor![1], 'https://confluence.example.com/x/ADR-14')
})

test('a non-http scheme is refused by name, not silently dropped', () => {
  assert.throws(() => parseModel(model('javascript:alert(1)')), (e: unknown) => {
    assert.ok(e instanceof ModelError)
    assert.ok(String(e.message).includes('only http(s)'), String(e.message))
    return true
  })
})

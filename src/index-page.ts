/**
 * The index page — every stored diagram as a card, each one a live thumbnail of
 * its root level.
 *
 * This is how an agent hands a user a *set* of concepts: one link, one grid, every
 * diagram one click away. Server-rendered, so it survives a link preview and works
 * with JavaScript off.
 *
 * A card may crop, but it may not lie: a drawing wider than 3:1 is cropped to the
 * middle with edge fades and says how wide it is, and the countable facts (levels,
 * nodes, flows) are text, because at 0.1 scale no pixel survives.
 *
 * @module c4-view/index-page
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderModel } from './render.ts'
import { compareKeys } from './layout/geometry.ts'
import type { Model } from './types.ts'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)
/** Wider than this and a thumbnail is a grey smear, so it crops instead (visual spec §6). */
const WIDE = 3

export interface IndexEntry {
  id: string
  title: string
  levels: string[]
  updated: string
  /** the root level's drawing, and whether every gate passed */
  svg: string
  ok: boolean
  /** the drawing's own size, in SVG user units */
  width: number
  nodes: number
  flows: number
  /** wider than 3:1 — the card crops it and says so */
  wide: boolean
}

/** One row of the store's listing, turned into a card (root level rendered for the thumb). */
export function indexEntries(
  rows: ReadonlyArray<{ id: string; title: string; levels: string[]; updated: string }>,
  load: (id: string) => Model | null,
  limit = 60, // ponytail: the whole grid renders every root level per request; page it past a few dozen
): IndexEntry[] {
  return rows.slice(0, limit).flatMap((row) => {
    const model = load(row.id)
    if (!model) return []
    const root = renderModel(model, '').levels[0]
    if (!root) return []
    const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(root.svg)
    const [width, height] = box ? [Number(box[1]), Number(box[2])] : [0, 0]
    return [{ ...row, svg: root.svg, ok: root.audit.ok, width: Math.round(width), nodes: root.audit.nodes, flows: root.audit.edges, wide: height > 0 && width / height > WIDE }]
  })
}

/** Newest first; ties by id so the grid is stable between requests. */
function byUpdated(a: IndexEntry, b: IndexEntry): number {
  if (a.updated === b.updated) return compareKeys(a.id, b.id)
  return a.updated < b.updated ? 1 : -1
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function card(entry: IndexEntry): string {
  const facts = `${count(entry.levels.length, 'level')} · ${count(entry.nodes, 'node')} · ${count(entry.flows, 'flow')}`
  const state = entry.ok ? 'audit clean' : 'audit failed'
  // the whole card is the link, so middle-click and cmd-click work without a handler
  return (
    `<a class="card" href="/d/${encodeURIComponent(entry.id)}">` +
    // the drawing is the emitter's own escaped output — never re-escape it. A crop is
    // declared in text ("wide · 3000 px") rather than passed off as the whole drawing.
    `<span class="thumb${entry.wide ? ' is-wide' : ''}" aria-hidden="true">${entry.svg}` +
    `${entry.wide ? `<span class="chip">wide · ${entry.width} px</span>` : ''}</span>` +
    `<span class="meta"><h2>${esc(entry.title)}</h2>` +
    `<p>${esc(entry.id)} · ${facts}</p>` +
    `<span class="badge ${entry.ok ? 'ok' : 'bad'}">${state}</span></span></a>`
  )
}

export function indexPage(entries: readonly IndexEntry[]): string {
  const sorted = [...entries].sort(byUpdated)
  const cards = sorted.length
    ? sorted.map(card).join('')
    : `<div class="empty"><p>No diagrams yet.</p><p>Post a model: <code>curl -X POST --data @model.json http://calm:8788/api/diagrams</code></p></div>`
  const diagramCount = sorted.length === 1 ? '1 diagram' : `${sorted.length} diagrams`
  return readFileSync(`${PUBLIC}index.html`, 'utf8')
    .replace('<!--COUNT-->', () => esc(diagramCount))
    .replace('<!--CARDS-->', () => cards)
}

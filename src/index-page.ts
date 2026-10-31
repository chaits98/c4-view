/**
 * The index page — every stored diagram as a card, each one a live thumbnail of
 * its root level.
 *
 * This is how an agent hands a user a *set* of concepts: one link, one grid, every
 * diagram one click away. Server-rendered, so it survives a link preview and works
 * with JavaScript off.
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

export interface IndexEntry {
  id: string
  title: string
  levels: string[]
  updated: string
  /** the root level's drawing, and whether every gate passed */
  svg: string
  ok: boolean
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
    return [{ ...row, svg: root.svg, ok: root.audit.ok }]
  })
}

/** Newest first; ties by id so the grid is stable between requests. */
function byUpdated(a: IndexEntry, b: IndexEntry): number {
  if (a.updated === b.updated) return compareKeys(a.id, b.id)
  return a.updated < b.updated ? 1 : -1
}

function card(entry: IndexEntry): string {
  const levels = entry.levels.length === 1 ? '1 level' : `${entry.levels.length} levels`
  const state = entry.ok ? 'audit clean' : 'audit failed'
  return (
    `<a class="card" href="/d/${encodeURIComponent(entry.id)}">` +
    // the drawing is the emitter's own escaped output — never re-escape it
    `<span class="thumb">${entry.svg}</span>` +
    `<span class="meta"><h2>${esc(entry.title)}</h2>` +
    `<p>${esc(entry.id)} · ${levels} · ${esc(entry.updated.slice(0, 16).replace('T', ' '))}</p>` +
    `<span class="badge ${entry.ok ? 'ok' : 'bad'}">${state}</span></span></a>`
  )
}

export function indexPage(entries: readonly IndexEntry[]): string {
  const sorted = [...entries].sort(byUpdated)
  const cards = sorted.length
    ? sorted.map(card).join('')
    : `<div class="empty"><p>No diagrams yet.</p><p>Post a model: <code>curl -X POST --data @model.json http://calm:8788/api/diagrams</code></p></div>`
  const count = sorted.length === 1 ? '1 diagram' : `${sorted.length} diagrams`
  return readFileSync(`${PUBLIC}index.html`, 'utf8')
    .replace('<!--COUNT-->', () => esc(count))
    .replace('<!--CARDS-->', () => cards)
}

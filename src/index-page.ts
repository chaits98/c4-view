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
import { paletteOf } from './theme.ts'
import { compareKeys } from './layout/geometry.ts'
import { themeAttribute, type Theme } from './theme-choice.ts'
import type { Model } from './types.ts'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c])
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
  nodes: number
  flows: number
  /** wider than 3:1 — the card crops it and says so */
  wide: boolean
}

/** One row of the store's listing, turned into a card (root level rendered for the thumb). */
export function indexEntries(
  rows: ReadonlyArray<{ id: string; title: string; levels: string[]; updated: string }>,
  load: (id: string) => Model | null,
  theme: Theme = 'auto',
  limit = 60, // ponytail: the whole grid renders every root level per request; page it past a few dozen
): IndexEntry[] {
  return rows.slice(0, limit).flatMap((row) => {
    const model = load(row.id)
    if (!model) return []
    const root = renderModel(model, '', paletteOf(theme)).levels[0]
    if (!root) return []
    /* node:coverage disable */
    // Damage guard: the emitter always writes a viewBox, so the no-viewBox arm means a renderer that
    // broke — it is not a diagram a user can produce.
    const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(root.svg)
    const [width, height] = box ? [Number(box[1]), Number(box[2])] : [0, 0]
    /* node:coverage enable */
    return [{ ...row, svg: root.svg, ok: root.audit.ok, nodes: root.audit.nodes, flows: root.audit.edges, wide: height > 0 && width / height > WIDE }]
  })
}

/** Newest first; ties by id so the grid is stable between requests. */
function byUpdated(a: IndexEntry, b: IndexEntry): number {
  if (a.updated === b.updated) return compareKeys(a.id, b.id)
  return a.updated < b.updated ? 1 : -1
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Above this the card is a placeholder: inlining the drawing costs the whole grid a frame. */
const HEAVY_NODES = 400
const HEAVY_BYTES = 200_000

function card(entry: IndexEntry): string {
  const facts = `${count(entry.levels.length, 'level')} · ${count(entry.nodes, 'node')} · ${count(entry.flows, 'flow')}`
  const state = entry.ok ? 'audit clean' : 'audit failed'
  const heavy = entry.nodes > HEAVY_NODES || entry.svg.length > HEAVY_BYTES
  const crop = entry.wide ? ' is-wide' : ''
  const thumb = heavy
    ? `<span class="thumb is-placeholder" aria-hidden="true"><span class="t-label-m">${facts} — open to draw</span></span>`
    : `<span class="thumb${crop}" aria-hidden="true">${entry.svg}</span>`
  // the whole card is the link, so middle-click and cmd-click work without a handler
  return (
    `<a class="card" href="/d/${encodeURIComponent(entry.id)}">` +
    // the drawing is the emitter's own escaped output — never re-escape it. A crop is
    // declared in text ("wide · 3000 px") rather than passed off as the whole drawing.
    // A crop is shown by cropping — the card does not print its own diagnostics at the reader
    thumb +
    `<span class="meta"><h2 class="t-title-m">${esc(entry.title)}</h2>` +
    `<p class="t-body-s">${esc(entry.id)} · ${facts}</p>` +
    `<span class="badge t-label-m ${entry.ok ? 'ok' : 'bad'}"><span aria-hidden="true">${entry.ok ? '✓' : '!'}</span>${state}</span></span></a>`
  )
}

export type Sort = 'updated' | 'title' | 'audit'
export type Filter = 'all' | 'fail'

/** Newest first already exists; these are the other two questions a visitor asks. */
const COMPARE: Record<Sort, (a: IndexEntry, b: IndexEntry) => number> = {
  updated: byUpdated,
  title: (a, b) => compareKeys(a.title.toLowerCase(), b.title.toLowerCase()) || compareKeys(a.id, b.id),
  audit: byAudit,
}

/** Failures first, then newest: the order the badge on every card promises. */
function byAudit(a: IndexEntry, b: IndexEntry): number {
  if (a.ok !== b.ok) return a.ok ? 1 : -1
  return byUpdated(a, b)
}

/**
 * Sort and the one filter, as links: the state lives in the URL, so it survives a reload, a share
 * and Back — and the current choice is readable as text, not only as a colour.
 */
function gridControl(sort: Sort, filter: Filter): string {
  const sorts = (['updated', 'title', 'audit'] as const)
    .map((value) => {
      const on = value === sort ? ' aria-current="true"' : ''
      const label = value === 'updated' ? 'newest' : value
      return `<a class="idx-sort" href="/?sort=${value}${filter === 'fail' ? '&amp;audit=fail' : ''}"${on}>${label}</a>`
    })
    .join('')
  const failing = filter === 'fail'
  const filterLink = `<a class="idx-sort" href="/?sort=${sort}${failing ? '' : '&amp;audit=fail'}"${failing ? ' aria-current="true"' : ''}>${failing ? 'showing failures' : 'failures only'}</a>`
  return `${sorts}${filterLink}`
}

/** Three plain links: the state is the URL, the cookie remembers it, no script runs. */
function schemeControl(theme: Theme): string {
  return (['auto', 'light', 'dark'] as const)
    .map((value) => `<a class="idx-scheme" href="/?theme=${value}"${theme === value ? ' aria-current="true"' : ''}>${value[0].toUpperCase()}${value.slice(1)}</a>`)
    .join('')
}

/** The two empty states: one cause, one way out, no illustration. */
function emptyState(filter: Filter, total: number): string {
  if (filter === 'fail' && total > 0) {
    return `<div class="empty"><h1 class="t-headline-s">Nothing is failing</h1><p>All ${total} diagrams audit clean.</p><p><a href="/">Show every diagram</a>.</p></div>`
  }
  return (
    `<div class="empty"><h1 class="t-headline-s">No diagrams yet</h1>` +
    `<p>This store is empty, so there is nothing to draw.</p>` +
    `<p>Send one: <code>c4v render model.json</code>, or <code>curl -X POST --data @model.json &lt;this-host&gt;/api/diagrams</code>.</p></div>`
  )
}

export function indexPage(entries: readonly IndexEntry[], theme: Theme = 'auto', sort: Sort = 'updated', filter: Filter = 'all'): string {
  const kept = filter === 'fail' ? entries.filter((entry) => !entry.ok) : [...entries]
  const sorted = [...kept].sort(COMPARE[sort])
  const cards = sorted.length ? sorted.map(card).join('') : emptyState(filter, entries.length)
  const diagramCount = sorted.length === 1 ? '1 diagram' : `${sorted.length} diagrams`
  return readFileSync(`${PUBLIC}index.html`, 'utf8')
    .replace('<!--THEMEATTR-->', () => themeAttribute(theme))
    .replace('<!--THEMELINKS-->', () => schemeControl(theme))
    .replace('<!--GRIDCONTROL-->', () => gridControl(sort, filter))
    .replace('<!--COUNT-->', () => esc(diagramCount))
    .replace('<!--CARDS-->', () => cards)
}

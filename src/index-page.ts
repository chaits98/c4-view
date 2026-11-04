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
import { lensReport } from './lens.ts'
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
  created: string
  updated: string
  /** the reader pinned this to the front of the grid; the model knows nothing about it */
  pinned: boolean
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
  rows: ReadonlyArray<{ id: string; title: string; levels: string[]; created: string; updated: string; pinned: boolean }>,
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
    // the badge is the verdict: geometry AND the modelling checks, the same thing `c4v audit --strict` says.
    // A card that says "clean" while `audit` fails the model is worse than no badge at all.
    const ok = root.audit.ok && lensReport(model).problems.length === 0
    // a card is the wrong shape for a strip in EITHER direction: past 3:1 across, or past 1:3 down, the
    // thumbnail is a squeezed lie, so it crops and the crop is declared
    // coverage:invariant — the drawing always carries a viewBox, so its height is never zero
    const ratio = height > 0 ? width / height : 0
    return [{ ...row, svg: root.svg, ok, nodes: root.audit.nodes, flows: root.audit.edges, wide: ratio > WIDE || (ratio > 0 && ratio < 1 / WIDE) }]
  })
}

/** Newest first; ties by id so the grid is stable between requests. */
function byUpdated(a: IndexEntry, b: IndexEntry): number {
  if (a.updated === b.updated) return compareKeys(a.id, b.id)
  return a.updated < b.updated ? 1 : -1
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Icons, because a row of words floating over every drawing is a wall, not a control. */
const KEBAB = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>'
const PIN_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l-1 6 4 3v2H6v-2l4-3z"/><path d="M12 14v7"/></svg>'
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>'

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
  // the drawing is the link, so middle-click and cmd-click work without a handler; the actions live in a
  // kebab in the corner (PatternFly card guidance: several actions on a card go in an overflow menu)
  const pinWord = entry.pinned ? 'Unpin' : 'Pin to front'
  // one date when there is only one story: "created X · updated X" is noise on a fresh diagram
  const dates = entry.created.slice(0, 10) === entry.updated.slice(0, 10)
    ? `updated ${esc(entry.updated.slice(0, 10))}`
    : `created ${esc(entry.created.slice(0, 10))} · updated ${esc(entry.updated.slice(0, 10))}`
  const pinChip = entry.pinned ? `<span class="badge pinned t-label-m">${PIN_ICON}<span>Pinned</span></span>` : ''
  return (
    `<article class="card${entry.pinned ? ' is-pinned' : ''}">` +
    `<button type="button" class="card-kebab" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${esc(entry.title)}">${KEBAB}</button>` +
    `<div class="card-menu-sheet" role="menu" hidden>` +
    `<button type="button" role="menuitem" class="card-action" data-pin="${esc(entry.id)}" aria-pressed="${entry.pinned}">` +
    `${PIN_ICON}<span>${pinWord}</span></button>` +
    `<button type="button" role="menuitem" class="card-action card-action--bad" data-del="${esc(entry.id)}">` +
    `${TRASH_ICON}<span>Delete</span></button></div>` +
    // the drawing is the emitter's own escaped output — never re-escape it. A crop is
    // shown by cropping — the card does not print its own diagnostics at the reader
    `<a class="card-open" href="/d/${encodeURIComponent(entry.id)}">` +
    thumb +
    `<span class="meta"><h2 class="t-title-m">${esc(entry.title)}</h2>` +
    `<p class="t-body-s">${esc(entry.id)} · ${facts}</p>` +
    `<p class="t-body-s card-dates">${dates}</p>` +
    `<span class="meta-row"><span class="badge ${entry.ok ? 'ok' : 'bad'} t-label-m"><span aria-hidden="true">${entry.ok ? '✓' : '!'}</span>${state}</span>${pinChip}</span>` +
    `</span></a></article>`
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
  const filterLink =
    `<span class="idx-sort-sep" aria-hidden="true"></span>` +
    `<a class="idx-sort" href="/?sort=${sort}${failing ? '' : '&amp;audit=fail'}"${failing ? ' aria-current="true"' : ''}>${failing ? 'showing failures' : 'failures only'}</a>`
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
  // pin means the front: it is a promise the button makes, so it outranks the chosen order
  const sorted = [...kept].sort(COMPARE[sort]).sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const cards = sorted.length ? sorted.map(card).join('') : emptyState(filter, entries.length)
  const diagramCount = sorted.length === 1 ? '1 diagram' : `${sorted.length} diagrams`
  return readFileSync(`${PUBLIC}index.html`, 'utf8')
    .replace('<!--THEMEATTR-->', () => themeAttribute(theme))
    .replace('<!--THEMELINKS-->', () => schemeControl(theme))
    .replace('<!--GRIDCONTROL-->', () => gridControl(sort, filter))
    .replace('<!--COUNT-->', () => esc(diagramCount))
    .replace('<!--CARDS-->', () => cards)
}

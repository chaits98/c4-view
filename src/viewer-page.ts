/**
 * The one diagram page: the server renders the level's SVG into public/viewer.html.
 *
 * There is exactly ONE template. A second, hardcoded copy here once dropped /flow.js from
 * the page, and the animation silently never ran. Breadcrumbs always start at `/`, so a
 * diagram is never a dead end.
 *
 * The zoom lives in the URL (`?zoom=1`) and is rendered as a class, so the reading size
 * survives a reload and the Back button, and applies before the first paint with no JS.
 *
 * @module c4-view/viewer-page
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { levelOf, levelOrder } from './model.ts'
import { renderModel } from './render.ts'
import { paletteOf } from './theme.ts'
import { themeAttribute, type Theme } from './theme-choice.ts'
import type { Model } from './types.ts'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** The zoom ladder, mirrored in public/viewer.js — a class per step, so `?zoom=` needs no JS. */
const LADDER = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const PRESETS: ReadonlyArray<readonly [string, string]> = [['fit', 'Fit'], ['1', '100%'], ['2', '200%']]

/** Every untrusted string in the page goes through this; the svg is already escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)
}

/** `?zoom=` → the nearest ladder step; absent, `fit` or nonsense → null (Fit). */
function zoomOf(raw: string | null): number | null {
  if (!raw || raw === 'fit') return null
  const wanted = Number(raw)
  if (!Number.isFinite(wanted) || wanted <= 0) return null
  return LADDER.reduce((best, step) => (Math.abs(step - wanted) < Math.abs(best - wanted) ? step : best), LADDER[0])
}

/** `100%`, `125%`, … or the word `Fit`, from a ladder step. */
const percentOf = (zoom: number | null): number => (zoom === null ? 0 : Math.round(zoom * 100))
const sizeOf = (percent: number): string => (percent === 0 ? 'Fit' : `${percent}%`)

/** The zoom cluster: three preset links (real hrefs, so they survive JS being off) and −/+. */
function zoomBar(href: (value: string) => string, zoom: number | null, percent: number): string {
  const presets = PRESETS.map(([value, text]) => {
    const on = value === 'fit' ? zoom === null : Number(value) === zoom
    return `<a class="c4-zoom-btn" href="${href(value)}" data-zoom="${value}"${on ? ' aria-current="true"' : ''}>${text}</a>`
  })
  return [
    ...presets,
    '<button type="button" class="c4-zoom-btn" data-step="-1" aria-label="Zoom out">−</button>',
    '<button type="button" class="c4-zoom-btn" data-step="1" aria-label="Zoom in">+</button>',
    `<span id="c4-zoom-readout" class="c4-zoom-readout">${sizeOf(percent)}</span>`,
  ].join('')
}

/** `all / id / level…`, each ancestor a real link, the last one plain text. */
function crumbsFor(model: Model, level: string, root: string): string[] {
  const crumbs = [`<a href="/">all</a>`, `<a href="${esc(root)}">${esc(model.id)}</a>`]
  let at = ''
  for (const segment of level ? level.split('/') : []) {
    at = at ? `${at}/${segment}` : segment
    const found = levelOf(model, at)
    if (!found) continue
    const title = esc(found.title ?? found.path)
    const href = root + '/' + at
    crumbs.push(at === level ? `<span>${title}</span>` : `<a href="${esc(href)}">${title}</a>`)
  }
  if (level === '') crumbs.push(`<span>${esc(levelOf(model, '')?.title ?? 'Overview')}</span>`)
  return crumbs
}

/**
 * The same diagram as text: containers, then flows, in the model's own order.
 *
 * Not decoration. A screen reader gets nothing useful from the SVG, a human greps a text version
 * faster than they read a drawing, and it is the only way to copy an id out of a diagram.
 */
function textVersion(model: Model, level: string): string {
  const found = levelOf(model, level)
  if (!found) return ''
  const nodes = found.nodes
    .map((n) => {
      const facts = [n.tech, n.desc].filter((v): v is string => Boolean(v))
      return `<li><strong>${esc(n.label)}</strong> <code>${esc(n.id)}</code>${facts.length ? ` — ${facts.map(esc).join(' · ')}` : ''}</li>`
    })
    .join('')
  const flows = found.edges
    .map((e) => {
      const from = found.nodes.find((n) => n.id === e.from)?.label ?? e.from
      const to = found.nodes.find((n) => n.id === e.to)?.label ?? e.to
      return `<li>${esc(from)} → ${esc(to)}${e.label ? ` — ${esc(e.label)}` : ''}</li>`
    })
    .join('')
  return (
    `<h2 class="t-label-l">Containers (${found.nodes.length})</h2><ul>${nodes}</ul>` +
    `<h2 class="t-label-l">Flows (${found.edges.length})</h2><ul>${flows || '<li>none on this level</li>'}</ul>`
  )
}

export function viewerPage(model: Model, level: string, zoomRaw: string | null = null, theme: Theme = 'auto'): string {
  const drawn = renderModel(model, level, paletteOf(theme)).levels[0]
  const root = `/d/${model.id}`
  const crumbs = crumbsFor(model, level, root)
  const options = levelOrder(model)
    .map((l) => `<option value="${esc(l.path)}"${l.path === level ? ' selected' : ''}>${esc(l.title ?? l.path)}</option>`)
    .join('')
  const zoom = zoomOf(zoomRaw)
  const percent = percentOf(zoom)
  const levelRoot = level ? root + '/' + level : root
  const zoomHref = (value: string): string => esc(levelRoot + '?zoom=' + value)

  // ONE template: public/viewer.html. A second, hardcoded copy in this file silently dropped
  // /flow.js from the page and the animation never ran (measured 2026-10-28).
  const template = readFileSync(join(PUBLIC, 'viewer.html'), 'utf8')
  return template
    .replace('<title>C4 viewer</title>', () => `<title>${esc(drawn.title)} — ${esc(model.title)}</title>`)
    .replace('<!--THEMEATTR-->', () => themeAttribute(theme))
    .replace('<!--CRUMBS-->', () => crumbs.join(' / '))
    .replace('<!--LEVELS-->', () => options)
    .replace('<!--ZOOM-->', () => zoomBar(zoomHref, zoom, percent))
    .replace('class="<!--ZOOMCLASS-->"', () => `class="${percent ? 'zoom-' + percent : 'zoom-fit'}"`)
    .replace('<!--TEXT-->', () => textVersion(model, level))
    .replace('<!--SVG-->', () => drawn.svg)
    .replace(
      ' data-diagram="" data-level="" data-root=""',
      () => ` data-diagram="${esc(model.id)}" data-level="${esc(level)}" data-root="${esc(root)}"`,
    )
}

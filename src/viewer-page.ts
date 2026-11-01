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

/** The zoom cluster: three preset links (real hrefs, so they survive JS being off) and −/+. */
function zoomBar(href: (value: string) => string, zoom: number | null): string {
  const presets = PRESETS.map(([value, text]) => {
    const on = value === 'fit' ? zoom === null : Number(value) === zoom
    return `<a class="c4-zoom-btn" href="${href(value)}" data-zoom="${value}"${on ? ' aria-current="true"' : ''}>${text}</a>`
  })
  return [
    ...presets,
    '<button type="button" class="c4-zoom-btn" data-step="-1" aria-label="Zoom out">−</button>',
    '<button type="button" class="c4-zoom-btn" data-step="1" aria-label="Zoom in">+</button>',
    `<span id="c4-zoom-readout" class="c4-zoom-readout">${zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>`,
  ].join('')
}

export function viewerPage(model: Model, level: string, zoomRaw: string | null = null, theme: Theme = 'auto'): string {
  const drawn = renderModel(model, level).levels[0]
  const levels = levelOrder(model)
  const root = `/d/${model.id}`
  const crumbs = [`<a href="/">all</a>`, `<a href="${esc(root)}">${esc(model.id)}</a>`]
  let at = ''
  for (const segment of level ? level.split('/') : []) {
    at = at ? `${at}/${segment}` : segment
    const found = levelOf(model, at)
    if (!found) continue
    const title = esc(found.title ?? found.path)
    const href = `${root}/${at}`
    crumbs.push(at === level ? `<span>${title}</span>` : `<a href="${esc(href)}">${title}</a>`)
  }
  if (level === '') crumbs.push(`<span>${esc(levelOf(model, '')?.title ?? 'Overview')}</span>`)
  const options = levels
    .map((l) => `<option value="${esc(l.path)}"${l.path === level ? ' selected' : ''}>${esc(l.title ?? l.path)}</option>`)
    .join('')
  const zoom = zoomOf(zoomRaw)
  const zoomHref = (value: string): string => esc(`${root}${level ? `/${level}` : ''}?zoom=${value}`)

  // ONE template: public/viewer.html. A second, hardcoded copy in this file silently dropped
  // /flow.js from the page and the animation never ran (measured 2026-10-28).
  const template = readFileSync(join(PUBLIC, 'viewer.html'), 'utf8')
  return template
    .replace('<title>C4 viewer</title>', () => `<title>${esc(drawn.title)} — ${esc(model.title)}</title>`)
    .replace('<!--THEMEATTR-->', () => themeAttribute(theme))
    .replace('<!--CRUMBS-->', () => crumbs.join(' / '))
    .replace('<!--LEVELS-->', () => options)
    .replace('<!--ZOOM-->', () => zoomBar(zoomHref, zoom))
    .replace('class="<!--ZOOMCLASS-->"', () => `class="${zoom === null ? 'zoom-fit' : `zoom-${Math.round(zoom * 100)}`}"`)
    .replace('<!--SVG-->', () => drawn.svg)
    .replace(
      ' data-diagram="" data-level="" data-root=""',
      () => ` data-diagram="${esc(model.id)}" data-level="${esc(level)}" data-root="${esc(root)}"`,
    )
}

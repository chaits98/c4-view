/**
 * The one diagram page: the server renders the level's SVG into public/viewer.html.
 *
 * There is exactly ONE template. A second, hardcoded copy here once dropped /flow.js from
 * the page, and the animation silently never ran. Breadcrumbs always start at `/`, so a
 * diagram is never a dead end.
 *
 * @module c4-view/viewer-page
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { levelOf, levelOrder } from './model.ts'
import { renderModel } from './render.ts'
import type { Model } from './types.ts'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Every untrusted string in the page goes through this; the svg is already escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)
}

export function viewerPage(model: Model, level: string): string {
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

  // ONE template: public/viewer.html. A second, hardcoded copy in this file silently dropped
  // /flow.js from the page and the animation never ran (measured 2026-10-28).
  const template = readFileSync(join(PUBLIC, 'viewer.html'), 'utf8')
  return template
    .replace('<title>C4 viewer</title>', () => `<title>${esc(drawn.title)} — ${esc(model.title)}</title>`)
    .replace('<!--CRUMBS-->', () => crumbs.join(' / '))
    .replace('<!--LEVELS-->', () => options)
    .replace('<!--SVG-->', () => drawn.svg)
    .replace(
      ' data-diagram="" data-level="" data-root=""',
      () => ` data-diagram="${esc(model.id)}" data-level="${esc(level)}" data-root="${esc(root)}"`,
    )
}


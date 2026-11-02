/**
 * The controls in the viewer's header: the two view modes and the download menu.
 *
 * Both are plain links, like the zoom presets — a mode survives a reload, a share and Back, and a
 * download is a file the browser already knows how to save.
 *
 * @module c4-view/viewer-controls
 */
import { renderLevel, type RenderedLevel } from './render.ts'
import { paletteOf } from './theme.ts'
import type { Theme } from './theme-choice.ts'
import type { LevelSpec, Model } from './types.ts'

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * The files this view can leave as: the drawing itself (svg, png), the drawing in a page that opens with
 * no server (html), and every level one after another (layers) — the drill pictures, for a reader who
 * wants the parts. Exporting what is on screen means carrying the view and the level in the link.
 */
export function downloads(id: string, level: string, full: boolean): string {
  const query = new URLSearchParams()
  if (level) query.set('level', level)
  if (full) query.set('view', 'full')
  const tail = query.toString() ? `?${query}` : ''
  const items: Array<[string, string, string]> = [
    ['svg', 'SVG', 'the drawing, as a vector file'],
    ['png', 'PNG', 'the drawing, as an image'],
    ['html', 'HTML', 'the drawing in a page that needs no server'],
    ['layers', 'All layers', 'every level, one after another'],
  ]
  return items
    .map(([format, label, hint]) => {
      const href = format === 'layers' ? `/d/${id}.layers` : `/d/${id}.${format}${tail}`
      return `<a role="menuitem" href="${esc(href)}" title="${esc(hint)}" download>${label}</a>`
    })
    .join('')
}

/**
 * The two ways to read the same model: one level with its drill frames, or every level opened at once.
 */
export function viewMode(levelRoot: string, mode: 'full' | 'drill'): string {
  const link = (value: 'full' | 'drill', text: string): string => {
    const href = value === 'full' ? `${levelRoot}?view=full` : levelRoot
    const on = value === mode
    return `<a class="c4-zoom-btn" href="${esc(href)}" data-view="${value}"${on ? ' aria-current="true"' : ''}>${text}</a>`
  }
  return link('drill', 'Drill in') + link('full', 'Full diagram')
}

/** One level with its drilled box expanded — what the old full view drew, still used by drill links. */
export function composed(model: Model, spec: LevelSpec, theme: Theme): { level: RenderedLevel; spec: LevelSpec; note: string } {
  return { level: renderLevel(model, spec, paletteOf(theme), undefined, `/d/${model.id}`), spec, note: '' }
}

/** The picture the full view draws: every level, so its text version is the root level's. */
export function fullSpec(model: Model): LevelSpec {
  return model.levels.find((l) => l.path === '') ?? { path: '', nodes: [], edges: [] }
}

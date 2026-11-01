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
import type { AuditReport } from './types.ts'
import { renderLevel, renderModel, type RenderedLevel } from './render.ts'
import { expandLevel } from './expand.ts'
import { hostOf } from './lens.ts'
import { paletteOf } from './theme.ts'
import { themeAttribute, type Theme } from './theme-choice.ts'
import type { LevelSpec, Model } from './types.ts'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** The zoom ladder, mirrored in public/viewer.js — a class per step, so `?zoom=` needs no JS. */
const LADDER = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
/** The laptop stage the design is measured against; wider drawings open at 100% instead of Fit. */
const STAGE_W = 1280
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
  // the readout only exists for the steps no preset names (75 %, 125 %, 150 %); repeating "Fit"
  // next to a chip that already says "Fit" is noise, and 240px away from it at that
  const named = PRESETS.some(([value]) => (value === 'fit' ? zoom === null : Number(value) === zoom))
  const readout = named ? '' : `<span id="c4-zoom-readout" class="c4-zoom-readout">${sizeOf(percent)}</span>`
  return [
    ...presets,
    '<button type="button" class="c4-zoom-btn" data-step="-1" aria-label="Zoom out">−</button>',
    '<button type="button" class="c4-zoom-btn" data-step="1" aria-label="Zoom in">+</button>',
    readout,
  ].join('')
}

/**
 * `all / id / box…`, each ancestor a real link, the current one an `<h1>` — the page's only heading,
 * named after the box you are inside (the frame's label), not after the file that holds its nodes.
 */
function crumbsFor(model: Model, level: string, root: string): string[] {
  const crumbs = [`<a href="/">all</a>`, `<a href="${esc(root)}">${esc(model.id)}</a>`]
  const segments = level ? level.split('/') : []
  const found: Array<{ at: string; title: string }> = []
  let at = ''
  for (const segment of segments) {
    at = at ? `${at}/${segment}` : segment
    const level = levelOf(model, at)
    if (!level) continue // a segment the model does not have is not a place, so it is not a crumb
    found.push({ at, title: esc(hostLabel(model, at) ?? level.title ?? segment) })
  }
  found.forEach((crumb, i) => {
    crumbs.push(
      i === found.length - 1
        ? `<h1 class="c4-crumb-h1" aria-current="page">${crumb.title}</h1>`
        : `<a href="${esc(root + '/' + crumb.at)}">${crumb.title}</a>`,
    )
  })
  if (!segments.length) crumbs.push(`<h1 class="c4-crumb-h1" aria-current="page">${esc(levelOf(model, '')?.title ?? 'Overview')}</h1>`)
  return crumbs
}

/** The node in the parent level that this path opens — the box whose name the page should show. */
function hostLabel(model: Model, path: string): string | undefined {
  const { parent, hostId } = hostOf({ path, nodes: [], edges: [] }, model)
  return parent?.nodes.find((n) => n.id === hostId)?.label
}

/**
 * The same diagram as text: containers, then flows, in the model's own order.
 *
 * Not decoration. A screen reader gets nothing useful from the SVG, a human greps a text version
 * faster than they read a drawing, and it is the only way to copy an id out of a diagram.
 */
function textVersion(model: Model, level: string, drawn?: LevelSpec): string {
  const found = drawn ?? levelOf(model, level)
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

const GATES: Array<{ key: keyof AuditReport; says: string }> = [
  { key: 'nodeNode', says: 'two containers overlap' },
  { key: 'wireNode', says: 'a wire runs through a container' },
  { key: 'wireWire', says: 'two wires share a track' },
  { key: 'chipNode', says: 'a label sits on a container' },
  { key: 'chipChip', says: 'two labels overlap' },
  { key: 'groupNode', says: 'a boundary box covers a container it does not own' },
]

/**
 * Why this drawing failed its audit, in words, above the canvas — three checks and a count, because
 * a stack of fifteen numbers is the same as none. The badge says *that* it failed; this says why.
 */
export function auditBanner(report: AuditReport): string {
  const failing = GATES.filter((gate) => (report[gate.key] as number) > 0)
  if (!failing.length) return ''
  const named = failing.slice(0, 3).map((gate) => `<li>${gate.says} (${String(report[gate.key])})</li>`)
  const more = failing.length > 3 ? `<li>and ${failing.length - 3} more check${failing.length - 3 === 1 ? '' : 's'}</li>` : ''
  return (
    `<section class="c4-audit" role="status">` +
    `<h2 class="t-title-s"><span aria-hidden="true">!</span> This drawing failed its audit</h2>` +
    `<ul class="t-body-s">${named.join('')}${more}</ul>` +
    `</section>`
  )
}

/**
 * What this page shows. `/d/<id>` is the root level; `/d/<id>/<path>` is that box EXPANDED — the parent
 * level with the host turned into a dashed frame — because a drill is a lens on one box, not a jump to
 * another drawing. A level that cannot expand (no ports, older model) still renders standalone, with a
 * note, rather than 404-ing on a link somebody shared.
 */
function draw(model: Model, level: string, theme: Theme): { level: RenderedLevel; spec: LevelSpec; note: string } {
  if (level !== '') {
    try {
      const expansion = expandLevel(model, level)
      const rendered = renderLevel(model, expansion.level, paletteOf(theme), drillFor(model, level), `/d/${model.id}`)
      return { level: rendered, spec: expansion.level, note: '' }
    } catch (error) {
      const found = levelOf(model, level)
      if (!found) throw error
      return {
        level: renderModel(model, level, paletteOf(theme), `/d/${model.id}`).levels[0],
        spec: found,
        note: `This level is not a lens: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  const root = levelOf(model, '')
  const rendered = renderModel(model, level, paletteOf(theme), `/d/${model.id}`).levels[0]
  return { level: rendered, spec: root ?? { path: '', nodes: [], edges: [] }, note: '' }
}

/** Drill targets for a composed level: an interior node's own level is `<path>/<inner id>`. */
function drillFor(model: Model, path: string): Map<string, string> {
  const { level } = expandLevel(model, path)
  const drill = new Map<string, string>()
  for (const node of level.nodes) {
    const target = node.id.startsWith(`${path}/`) ? node.id : undefined
    if (target && model.levels.some((l) => l.path === target)) drill.set(node.id, target)
  }
  return drill
}

/** Width of the drawing, from the viewBox the renderer just emitted. */
function svgWidth(svg: string): number {
  const box = /viewBox="0 0 ([\d.]+)/.exec(svg)
  return box ? Number(box[1]) : 0
}

/** A model that cannot expand still answers the link, and says why the picture is flat. */
function noteBanner(note: string): string {
  if (!note) return ''
  return `<section class="c4-audit" role="status"><h2 class="t-title-s">Not a lens</h2><p class="t-body-s">${esc(note)}</p></section>`
}

export function viewerPage(model: Model, level: string, zoomRaw: string | null = null, theme: Theme = 'auto'): string {
  const drawn = draw(model, level, theme)
  const root = `/d/${model.id}`
  const crumbs = crumbsFor(model, level, root)
  const options = levelOrder(model)
    .map((l) => `<option value="${esc(l.path)}"${l.path === level ? ' selected' : ''}>${esc(l.title ?? l.path)}</option>`)
    .join('')
  // A drawing more than ~1.6x the design stage renders ~5px labels at Fit; opening it at 100% is the
  // difference between "complete but unreadable" and "readable but partial". Explicit ?zoom= wins.
  const wide = zoomRaw === null && svgWidth(drawn.level.svg) > STAGE_W * 1.6
  const zoom = zoomOf(zoomRaw) ?? (wide ? 1 : null)
  const percent = percentOf(zoom)
  const wideNote = wide ? '<p class="c4-note t-body-s">Too wide to fit — opened at 100%. Scroll to pan, or pick Fit for the overview.</p>' : ''
  const levelRoot = level ? root + '/' + level : root
  const zoomHref = (value: string): string => esc(levelRoot + '?zoom=' + value)

  // ONE template: public/viewer.html. A second, hardcoded copy in this file silently dropped
  // /flow.js from the page and the animation never ran (measured 2026-10-28).
  const template = readFileSync(join(PUBLIC, 'viewer.html'), 'utf8')
  return template
    .replace('<title>C4 viewer</title>', () => `<title>${esc(drawn.level.title)} — ${esc(model.title)}</title>`)
    .replace('<!--THEMEATTR-->', () => themeAttribute(theme))
    .replace('<!--CRUMBS-->', () => crumbs.join(' / '))
    .replace('<!--LEVELS-->', () => options)
    .replace('<!--ZOOM-->', () => zoomBar(zoomHref, zoom, percent))
    .replace('class="<!--ZOOMCLASS-->"', () => `class="${percent ? 'zoom-' + percent : 'zoom-fit'}"`)
    .replace('<!--AUDIT-->', () => auditBanner(drawn.level.audit) + noteBanner(drawn.note) + wideNote)
    .replace('<!--TEXT-->', () => textVersion(model, level, drawn.spec))
    .replace('<!--SVG-->', () => drawn.level.svg)
    .replace(
      ' data-diagram="" data-level="" data-root=""',
      () => ` data-diagram="${esc(model.id)}" data-level="${esc(level)}" data-root="${esc(root)}"`,
    )
}

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
import { renderLevel, renderModel, type RenderedLevel } from './render.ts'
import { expandLevel } from './expand.ts'
import { hostOf } from './lens.ts'
import type { LevelDocs } from './docs.ts'
import { paletteOf } from './theme.ts'
import { themeAttribute, type Theme } from './theme-choice.ts'
import { zoomBar, zoomClass, zoomOf } from './viewer-zoom.ts'
import { composed, downloads, fullSpec, viewMode } from './viewer-controls.ts'
import type { AuditReport, EdgeSpec, LevelSpec, Model, NodeSpec } from './types.ts'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Every untrusted string in the page goes through this; the svg is already escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)
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
    if (!level) continue // a segment the model does not have is not a place, so it is not a crumb — coverage:invariant — parseModel requires every level's parent to exist
    found.push({ at, title: esc(hostLabel(model, at) ?? level.title ?? segment) })
  }
  found.forEach((crumb, i) => {
    crumbs.push(
      i === found.length - 1
        ? `<h1 class="c4-crumb-h1" aria-current="page">${crumb.title}</h1>`
        : `<a href="${esc(root + '/' + crumb.at)}">${crumb.title}</a>`,
    )
  })
  if (!segments.length) crumbs.push(`<h1 class="c4-crumb-h1" aria-current="page">${esc(levelOf(model, '')?.title ?? 'Overview')}</h1>`) // coverage:invariant — parseModel always produces a root level with a title
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
function textVersion(drawn: LevelSpec): string {
  const found = drawn
  const nodes = found.nodes.map((n) => nodeItem(n)).join('')
  const flows = found.edges.map((e) => edgeItem(found, e)).join('')
  return (
    `<h2 class="t-label-l">Containers (${found.nodes.length})</h2><ul>${nodes}</ul>` +
    `<h2 class="t-label-l">Flows (${found.edges.length})</h2><ul>${flows || '<li>none on this level</li>'}</ul>`
  )
}

/** One container line: name, id, then whatever facts the model gives. */
function nodeItem(node: NodeSpec): string {
  const facts = [node.tech, node.desc].filter((v): v is string => Boolean(v))
  const tail = facts.length ? ` — ${facts.map((f) => esc(f)).join(' · ')}` : ''
  return `<li><strong>${esc(node.label)}</strong> <code>${esc(node.id)}</code>${tail}</li>`
}

/** One flow line, with both ends named the way a reader knows them. */
function edgeItem(level: LevelSpec, edge: EdgeSpec): string {
  // parseModel refuses an edge whose ends are not nodes of the level, so the id fallback is unreachable
  /* node:coverage ignore next */
  const from = level.nodes.find((n) => n.id === edge.from)?.label ?? edge.from // coverage:invariant — parseModel refuses an edge end that is not a node of the level
  /* node:coverage ignore next */
  const to = level.nodes.find((n) => n.id === edge.to)?.label ?? edge.to // coverage:invariant — same, for the far end
  const label = edge.label ? ` — ${esc(edge.label)}` : ''
  return `<li>${esc(from)} → ${esc(to)}${label}</li>`
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
  const rest = failing.length - 3
  const word = rest === 1 ? 'check' : 'checks'
  const more = rest > 0 ? `<li>and ${rest} more ${word}</li>` : ''
  return (
    `<section class="c4-audit" role="status">` +
    `<h2 class="t-title-s"><span aria-hidden="true">!</span> This drawing failed its audit</h2>` +
    `<ul class="t-body-s">${named.join('')}${more}</ul>` +
    `</section>`
  )
}

/** What this page draws: the nested picture, one level with a box drilled, or the level as written. */
function pickDrawn(
  model: Model, level: string, theme: Theme, spec?: LevelSpec, full?: RenderedLevel,
): { level: RenderedLevel; spec: LevelSpec; note: string } {
  if (full) return { level: full, spec: fullSpec(model), note: '' }
  if (spec) return composed(model, spec, theme)
  return draw(model, level, theme)
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
  // the parser guarantees a root level (path ''), so this is a read, not a lookup
  const root = levelOf(model, '') as LevelSpec
  const rendered = renderModel(model, level, paletteOf(theme), `/d/${model.id}`).levels[0]
  return { level: rendered, spec: root, note: '' }
}

/** Drill targets for a composed level: an interior node's own level is `<path>/<inner id>`. */
function drillFor(model: Model, path: string): Map<string, string> {
  const { level } = expandLevel(model, path)
  const drill = new Map<string, string>()
  for (const node of level.nodes) {
    const target = node.id.startsWith(`${path}/`) ? node.id : undefined // coverage:invariant — outside nodes are never prefixed; an interior node may or may not have a level of its own
    // both arms run (level of its own / none); V8 reports the second as 0 on composed levels
    if (target && model.levels.some((l) => l.path === target)) drill.set(node.id, target) // coverage:invariant — see above
  }
  return drill
}

/** The C4 level a path depth belongs to: 0 → C1, 1 → C2, and never past C4. */
const levelTag = (depth: number): string => `C${Math.min(4, depth + 1)}`

/** Width and height of the drawing, from the viewBox the renderer just emitted. */
function svgSize(svg: string): { w: number; h: number } {
  // every string this reads was produced by emit(), which always writes a viewBox
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)/.exec(svg)
  // coverage:invariant — every string here came from emit(), which always writes a viewBox
  return box ? { w: Number(box[1]), h: Number(box[2]) } : { w: 0, h: 0 }
}

/**
 * Docs are keyed by the ids of the level they were written for; an expanded page draws those same ids with
 * the host prefix (`context1/a`). Re-key so the hover panel finds them without every caller knowing.
 */
function rekeyDocs(docs: LevelDocs | undefined, spec: LevelSpec): LevelDocs | undefined {
  if (!docs || !spec.path) return docs
  const prefix = `${spec.path}/`
  const shrink = (key: string): string => (key.startsWith(prefix) ? key.slice(prefix.length) : key)
  const nodes: Record<string, string> = {}
  for (const [id, html] of Object.entries(docs.nodes)) nodes[`${prefix}${id}`] = html
  const edges: Record<string, string> = {}
  for (const [key, html] of Object.entries(docs.edges)) {
    const [from, to] = key.split('->')
    edges[`${prefix}${from}->${prefix}${to}`] = html
  }
  // the frame's neighbours belong to the parent level and keep their own ids
  for (const node of spec.nodes) {
    if (shrink(node.id) !== node.id) continue
    if (docs.nodes[node.id]) nodes[node.id] = docs.nodes[node.id] // coverage:invariant — a doc exists only if the author wrote one; absence is the normal case
  }
  return { nodes, edges }
}

/** One JSON block per page, not one attribute per node: a doc is prose, and prose does not belong in markup. */
function docsBlock(docs?: LevelDocs): string {
  if (!docs || (!Object.keys(docs.nodes).length && !Object.keys(docs.edges).length)) return ''
  const json = JSON.stringify(docs).replace(/</g, '\\u003c')
  return `<script type="application/json" id="c4-docs">${json}</script>\n`
}

/** A model that cannot expand still answers the link, and says why the picture is flat. */
function noteBanner(note: string): string {
  if (!note) return ''
  return `<section class="c4-audit" role="status"><h2 class="t-title-s">Not a lens</h2><p class="t-body-s">${esc(note)}</p></section>`
}

export function viewerPage(
  model: Model,
  level: string,
  zoomRaw: string | null = null,
  theme: Theme = 'auto',
  docs?: LevelDocs,
  /** the level to draw instead of the one named — the full view passes its composed picture here */
  spec?: LevelSpec,
  /** the nested picture, already drawn: the full view is every level at once, not one level composed */
  full?: RenderedLevel,
): string {
  const drawn = pickDrawn(model, level, theme, spec, full)
  const root = `/d/${model.id}`
  const crumbs = crumbsFor(model, level, root)
  // indented by depth: the list is a tree, and a flat list of paths makes a reader work out the nesting
  const options = levelOrder(model)
    .map((l) => {
      const depth = l.path === '' ? 0 : l.path.split('/').length
      const indent = '&#160;&#160;&#160;'.repeat(depth)
      const label = `${levelTag(depth)} · ${l.title ?? l.path}` // coverage:invariant — parseModel fills a title
      return `<option value="${esc(l.path)}" title="${esc(l.path || 'context')}"${l.path === level ? ' selected' : ''}>${indent}${esc(label)}</option>`
    })
    .join('')
  // The opening view is the COMPLETE drawing: the fit that shows all of it, which is fit-v for a column and
  // fit-h for a strip. A reader who wants detail picks 100% and scrolls; the reverse — opening at 100% on a
  // drawing four screens wide — showed a corner and called it the diagram. Explicit `?zoom=` always wins.
  const drawnSize = svgSize(drawn.level.svg)
  const zoom = zoomOf(zoomRaw)
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
    .replace('<!--ZOOM-->', () => zoomBar(zoomHref, zoom))
    .replace('<!--VIEWMODE-->', () => viewMode(levelRoot, spec || full ? 'full' : 'drill'))
    .replace('<!--DOWNLOAD-->', () => downloads(model.id, level, Boolean(spec || full), theme))
    .replace('class="<!--ZOOMCLASS-->"', () => `class="${zoomClass(zoom, drawnSize)}"`)
    .replace('<!--AUDIT-->', () => auditBanner(drawn.level.audit) + noteBanner(drawn.note))
    .replace('<!--TEXT-->', () => textVersion(drawn.spec))
    .replace('<!--SVG-->', () => drawn.level.svg)
    // the authored docs for this level, as data: viewer.js renders them in the hover panel
    .replace('</body>', () => `${docsBlock(rekeyDocs(docs, drawn.spec))}</body>`)
    .replace(
      ' data-diagram="" data-level="" data-root=""',
      () => ` data-diagram="${esc(model.id)}" data-level="${esc(level)}" data-root="${esc(root)}"`,
    )
}

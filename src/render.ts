/**
 * The pipeline — the one function that turns a model into artefacts.
 *
 * Every stage is pure, so this file is only wiring plus the level loop: parse →
 * layout → route → emit → audit, per level, deterministically.
 *
 * @module c4-view/render
 */
import { readFileSync } from 'node:fs'
import { parseModel, layoutOf, drillTargets, levelOrder } from './model.ts'
import { lensReport, type LensReport } from './lens.ts'
import { expandLevel } from './expand.ts'
import { nestedLevel } from './nest.ts'
import { rank } from './layout/rank.ts'
import { order } from './layout/order.ts'
import { place } from './layout/place.ts'
import { route } from './layout/route.ts'
import { emit } from './svg/emit.ts'
import { DARK, type Theme } from './theme.ts'
import { audit } from './audit.ts'
import { placeLabels } from './layout/labels.ts'
import { measure } from './metrics.ts'
import { flowIndex } from './flow.ts'
import type { AuditReport, LevelSpec, Model } from './types.ts'

export interface RenderedLevel {
  path: string
  title: string
  svg: string
  audit: AuditReport
}

export interface Rendered {
  id: string
  title: string
  levels: RenderedLevel[]
  /** model-level checks: is each drill a lens or a layer redraw */
  lens: LensReport
}

/**
 * Swap the axes: the same drawing read top to bottom. Every number the audit measures — crossings, overlaps,
 * shared segments — is invariant under a swap of x and y, so a vertical picture is exactly as clean as the
 * horizontal one it came from. That is why this is a transform and not a second layout engine.
 */
export function transpose(placed: ReturnType<typeof place>, routed: ReturnType<typeof route>): { placed: ReturnType<typeof place>; routed: ReturnType<typeof route> } {
  const items = new Map<string, ReturnType<typeof place>['items'] extends Map<string, infer I> ? I : never>()
  for (const [id, it] of placed.items) items.set(id, { ...it, x: it.y, y: it.x, w: it.h, h: it.w })
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const [id, b] of placed.boxes) boxes.set(id, { x: b.y, y: b.x, w: b.h, h: b.w })
  const groups = placed.groups.map((g) => ({ ...g, box: { x: g.box.y, y: g.box.x, w: g.box.h, h: g.box.w } }))
  const routes = routed.routes.map((r) => ({
    ...r,
    pts: r.pts.map((p) => ({ x: p.y, y: p.x })),
    ...(r.label ? { label: { text: r.label.text, box: { x: r.label.box.y, y: r.label.box.x, w: r.label.box.h, h: r.label.box.w } } } : {}),
  }))
  return {
    placed: { ...placed, items, boxes, groups, size: { w: placed.size.h, h: placed.size.w } },
    routed: { routes, size: { w: routed.size.h, h: routed.size.w } },
  }
}

/**
 * One layout attempt at a given width budget.
 */
function attempt(level: LevelSpec, cfg: ReturnType<typeof layoutOf>, labels = true): { placed: ReturnType<typeof place>; routed: ReturnType<typeof route>; audit: AuditReport } {
  const placed = place(order(rank(level, cfg), cfg), level, cfg, measure)
  const routed = route(placed, cfg, measure, labels)
  return { placed, routed, audit: audit(placed, routed, level) }
}

/**
 * Lay a level out. Columns run left to right by default — the C4 convention, and what a reader expects.
 *
 * A strip more than five times as wide as it is tall cannot be read at 100% on a laptop, and panning it is
 * worse than scrolling. So a level that comes out that wide is transposed: the same drawing read top to
 * bottom. Transposing swaps x and y and nothing else, and every number the audit measures (crossings,
 * overlaps, shared segments) is invariant under that swap — so the vertical picture is exactly as clean as the
 * horizontal one, and there is no second layout engine to keep in step.
 */
export function layoutLevel(level: LevelSpec, cfg: ReturnType<typeof layoutOf>): { placed: ReturnType<typeof place>; routed: ReturnType<typeof route>; audit: AuditReport } {
  const wide = attempt(level, cfg)
  // a strip only hurts when it does not fit: 600x53 is small and reads fine, 2900x270 does not fit a laptop
  const fits = wide.routed.size.w <= MAX_WIDTH
  const turn = cfg.direction === 'TB' || (cfg.direction === 'auto' && !fits && wide.audit.aspect > WIDE_ASPECT)
  if (!turn) return wide
  // lay it out again with the axes declared, so each node claims its text width on the axis that will carry
  // it, then transpose. Transposing the first attempt alone sized every box as wide as a row is tall.
  const turned = attempt(level, { ...cfg, direction: 'TB' }, false)
  // an upright drawing is laid out again, not merely rotated, so it is a different drawing: keep the strip when
  // standing it up would make the picture harder to follow (measured: 26 crossings → 50 on one corpus level)
  if (cfg.direction === 'auto' && turned.audit.crossings > wide.audit.crossings) return wide
  const upright = transpose(turned.placed, turned.routed)
  // chips are placed AFTER the transpose: a chip is text, text is always horizontal, so it has to be measured
  // in the orientation the reader sees it in — placing it in the turned world made every chip one glyph wide
  const labelled = { ...upright.routed, routes: placeLabels(upright.routed.routes, upright.placed, { ...cfg, direction: 'TB' }, measure) }
  return { placed: upright.placed, routed: labelled, audit: audit(upright.placed, labelled, level) }
}

/** Past this many pixels a drawing has to be panned on a laptop, which is worse than scrolling. */
const MAX_WIDTH = 1600
/** And past this ratio it is a strip even before it is too wide. */
const WIDE_ASPECT = 3

/** Render one level: the whole pipeline, in order, with no hidden state. */
export function renderLevel(model: Model, level: LevelSpec, palette: Theme = DARK, drill?: Map<string, string>, linkBase?: string): RenderedLevel {
  const cfg = layoutOf(model)
  const { placed, routed, audit: report } = layoutLevel(level, cfg)
  // a composed (expanded) level is not in the model, so its drill map is supplied by the caller
  const svg = emit(placed, routed, level, cfg, palette, {
    drill: drill ?? drillTargets(model, level),
    flow: flowIndex(level),
    linkBase,
  })
  // coverage:invariant — a level always has a path; 'Overview' is for a hand-built spec
  return { path: level.path, title: level.title ?? level.path ?? 'Overview', svg, audit: report }
}

/** The whole model as one picture: every level drawn in place, inside its host's box. */
export function renderAll(model: Model): Rendered {
  return { id: model.id, title: `${model.title} — every level`, levels: [nestedLevel(model)], lens: lensReport(model) }
}

/** Render every level (root first, then by depth). */
export function renderModel(model: Model, only?: string, palette: Theme = DARK, linkBase?: string): Rendered {
  const levels = levelOrder(model).filter((l) => only === undefined || l.path === only)
  if (!levels.length) {
    const known = levelOrder(model).map((l) => l.path || '(root)').join(', ')
    throw new Error(`no level "${only ?? ''}" — this model has: ${known}`)
  }
  const lens = lensReport(model)
  return { id: model.id, title: model.title, levels: levels.map((level) => renderLevel(model, level, palette, undefined, linkBase)), lens }
}

/**
 * Render one box expanded in place: the parent level with its host replaced by a dashed frame around
 * the child's interior. One frame at a time, by design.
 */
export function renderExpanded(model: Model, path: string, palette: Theme = DARK): Rendered {
  const { level } = expandLevel(model, path)
  const drill = new Map<string, string>()
  for (const node of level.nodes) {
    const innerId = node.id.startsWith(`${path}/`) ? node.id.slice(path.length + 1) : undefined
    const target = innerId ? `${path}/${innerId}` : null
    if (target && model.levels.some((l) => l.path === target)) drill.set(node.id, target)
  }
  return {
    id: model.id,
    title: model.title,
    levels: [renderLevel(model, level, palette, drill, `/d/${model.id}`)],
    lens: lensReport(model),
  }
}

/** Read and validate a model file. One parse, so a caller that needs the model does not parse twice. */
export function readModel(file: string): Model {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    /* node:coverage disable */
    // Damage guard: every throw from readFileSync/parseModel is an Error; the String() arm covers a
    // library that throws a bare value.
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    /* node:coverage enable */
  }
  return parseModel(raw)
}

/** Read + validate + render a model file, optionally with one box expanded in place. */
export function renderFile(file: string, only?: string, expand?: string): Rendered {
  const model = readModel(file)
  return expand ? renderExpanded(model, expand) : renderModel(model, only)
}

/**
 * The audit of every picture this model can actually show. A level with a parent is served COMPOSED — that
 * is what `/d/<id>/<path>` draws — so auditing the flat level alone reports on a picture nobody opens.
 * Composed and flat can differ by tens of crossings; the drilled view is the one with the reader.
 */
export function pictureAudits(model: Model): AuditReport[] {
  return model.levels.map((level) => {
    if (!level.path) return renderModel(model, level.path).levels[0].audit
    try {
      return { ...renderExpanded(model, level.path).levels[0].audit, composed: true }
    } catch {
      // a level whose box does not exist above it cannot be drawn at all: report that as a failure, not a 500
      return { ...renderModel(model, level.path).levels[0].audit, ok: false }
    }
  })
}

/** Every level failed a geometry gate. */
export function failed(report: Rendered): RenderedLevel[] {
  return report.levels.filter((l) => !l.audit.ok)
}

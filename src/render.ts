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
import { rank } from './layout/rank.ts'
import { order } from './layout/order.ts'
import { place } from './layout/place.ts'
import { route } from './layout/route.ts'
import { emit } from './svg/emit.ts'
import { DARK, type Theme } from './theme.ts'
import { audit } from './audit.ts'
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
 * One layout attempt at a given width budget.
 */
function attempt(level: LevelSpec, cfg: ReturnType<typeof layoutOf>): { placed: ReturnType<typeof place>; routed: ReturnType<typeof route>; audit: AuditReport } {
  const placed = place(order(rank(level, cfg), cfg), level, cfg, measure)
  const routed = route(placed, cfg, measure)
  return { placed, routed, audit: audit(placed, routed, level) }
}

/**
 * Lay a level out, wrapping its columns only when wrapping does not cost more than it saves.
 *
 * A row of columns that runs past the width budget is panned instead of read, so wrapping is offered — but
 * the cross-row wires it needs can add crossings of their own, and on a dense level they can add more than the
 * width was worth (measured: a 21-node level went from 26 crossings to 56). So both are laid out and the one
 * with fewer crossings wins; on a tie the wrapped one, because it is the one that fits the screen.
 */
export function layoutLevel(level: LevelSpec, cfg: ReturnType<typeof layoutOf>): { placed: ReturnType<typeof place>; routed: ReturnType<typeof route>; audit: AuditReport } {
  const flat = attempt(level, cfg.rowWidth > 0 ? { ...cfg, rowWidth: 0 } : cfg)
  if (cfg.rowWidth <= 0) return flat
  const wrapped = attempt(level, cfg)
  if ((wrapped.placed.bands?.length ?? 0) < 2) return flat // coverage:invariant — place() always returns bands
  const narrower = wrapped.routed.size.w < flat.routed.size.w * 0.75
  const readable = wrapped.audit.crossingsPerEdge <= 1
  // both, or the strip keeps its single row: wrapping that costs crossings buys width with legibility
  return narrower && readable ? wrapped : flat
}

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

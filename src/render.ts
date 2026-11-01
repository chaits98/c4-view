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
}

/** Render one level: the whole pipeline, in order, with no hidden state. */
export function renderLevel(model: Model, level: LevelSpec, palette: Theme = DARK): RenderedLevel {
  const cfg = layoutOf(model)
  const ranked = order(rank(level, cfg), cfg)
  const placed = place(ranked, level, cfg, measure)
  const routed = route(placed, cfg, measure)
  const svg = emit(placed, routed, level, cfg, palette, drillTargets(model, level), flowIndex(level))
  return { path: level.path, title: level.title ?? level.path ?? 'Overview', svg, audit: audit(placed, routed, level) }
}

/** Render every level (root first, then by depth). */
export function renderModel(model: Model, only?: string, palette: Theme = DARK): Rendered {
  const levels = levelOrder(model).filter((l) => only === undefined || l.path === only)
  if (!levels.length) {
    const known = levelOrder(model).map((l) => l.path || '(root)').join(', ')
    throw new Error(`no level "${only ?? ''}" — this model has: ${known}`)
  }
  return { id: model.id, title: model.title, levels: levels.map((level) => renderLevel(model, level, palette)) }
}

/** Read + validate + render a model file. */
export function renderFile(file: string, only?: string): Rendered {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return renderModel(parseModel(raw), only)
}

/** Every level failed a geometry gate. */
export function failed(report: Rendered): RenderedLevel[] {
  return report.levels.filter((l) => !l.audit.ok)
}

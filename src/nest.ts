/**
 * The nested picture — every level open at once, each drawn by the ordinary pipeline.
 *
 * A drill composes one frame into its parent and lays the result out flat. For a whole model that flat
 * layout is the wrong shape: 27 edges ranked in one pass put a frame's chain in the same columns as
 * everything else, and the wires cross the drawing 40 times (measured 7.96 crossings/edge).
 *
 * So the full view does not compose levels at all. Each level is rendered on its own — the same clean
 * picture drill mode already produces, with its own ranks and its own routes — and the host box in the
 * parent is sized to hold that drawing. Cross-level edges land on the host box, which is where a C4
 * reader expects a boundary crossing anyway.
 *
 * @module c4-view/nest
 */
import { densityOf } from './audit.ts'
import { layoutOf } from './model.ts'
import { layoutLevel, type RenderedLevel } from './render.ts'
import { flowIndex } from './flow.ts'
import { emit } from './svg/emit.ts'
import { DARK, type Theme } from './theme.ts'
import type { AuditReport, LevelSpec, Model } from './types.ts'

/** Room inside a host box for the picture it holds, on top of the label at its head. */
export const NEST_PAD = 14
export const NEST_HEAD = 34

const COUNTS = ['nodeNode', 'wireNode', 'wireWire', 'chipChip', 'chipNode', 'groupNode', 'crossings', 'backward'] as const

export interface Picture {
  svg: string
  w: number
  h: number
  /** host node id → top-left of its child picture, in this picture's coordinates */
  hosts: Map<string, { x: number; y: number }>
  levels: number
  nodes: number
  edges: number
  /** every level's own report, summed: this picture is those pictures, one inside each host box */
  audit: AuditReport
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function emptyAudit(): AuditReport {
  return {
    ok: true, level: 'full', nodes: 0, edges: 0, nodeNode: 0, wireNode: 0, wireWire: 0, crossings: 0,
    crossingsPerEdge: 0, verdict: 'crisp', backward: 0, chipChip: 0, chipNode: 0, groupNode: 0, aspect: 1,
  }
}

function addAudit(acc: AuditReport, one: AuditReport): void {
  for (const key of COUNTS) acc[key] += one[key]
  acc.ok = acc.ok && one.ok
  acc.nodes += one.nodes
  acc.edges += one.edges
  // the same bands the audit prints, taken from the audit itself so the two can never disagree
  const { perEdge, verdict } = densityOf(acc.crossings, acc.edges)
  acc.crossingsPerEdge = perEdge
  acc.verdict = verdict
  acc.dense = verdict === 'dense' || verdict === 'over'
}

function depthOf(path: string): number {
  return path === '' ? 0 : path.split('/').length
}

/** A level with its hosts pre-sized to the pictures already rendered for them. */
function sized(model: Model, level: LevelSpec, pics: Map<string, Picture>): { spec: LevelSpec; inner: Map<string, Picture> } {
  const path = level.path
  const inner = new Map<string, Picture>()
  const nodes = level.nodes.map((node) => {
    const child = path === '' ? node.id : `${path}/${node.id}`
    const pic = model.levels.some((l) => l.path === child) ? pics.get(child) : undefined
    if (!pic) return node
    inner.set(node.id, pic)
    // a host is a frame, not a node: a stadium or diamond stretched to hold a drawing reads as a giant
    // oval cutting through its own contents
    return { ...node, shape: 'rect', w: pic.w + 2 * NEST_PAD, h: pic.h + 2 * NEST_PAD + NEST_HEAD }
  })
  return { spec: { ...level, nodes }, inner }
}

/** Put each child's drawing inside the box its host node was given. */
function embed(svg: string, at: Map<string, { x: number; y: number }>, inner: Map<string, Picture>): string {
  const groups = [...inner.entries()].flatMap(([host, pic]) => {
    const box = at.get(host)
    if (!box) return [] // coverage:invariant — `at` is built from the same hosts as `inner`
    const x = Math.round(box.x + NEST_PAD)
    const y = Math.round(box.y + NEST_PAD + NEST_HEAD)
    return [`<g transform="translate(${x} ${y})" class="c4-nested" data-host="${host}">${pic.svg}</g>`]
  })
  return groups.length ? svg.replace(/<\/svg>\s*$/, `${groups.join('')}</svg>`) : svg
}

/**
 * Every level of the model in one picture. Bottom-up, so a child is finished before its host is sized.
 */
export function nestedPicture(model: Model, theme: Theme = DARK, paint = false): Picture {
  const cfg = layoutOf(model)
  const pics = new Map<string, Picture>()
  const deepest = [...model.levels].sort((a, b) => depthOf(b.path) - depthOf(a.path))
  for (const level of deepest) {
    const { spec, inner } = sized(model, level, pics)
    const { placed, routed, audit: report } = layoutLevel(spec, cfg)
    const at = new Map<string, { x: number; y: number }>()
    for (const host of inner.keys()) {
      const box = placed.boxes.get(host)
      if (box) at.set(host, { x: box.x, y: box.y })
    }
    // each level keeps its own narration: without the flow map the picture has no steps to walk
    // the outermost picture paints the canvas; the nested ones would paint over their host's contents
    const background = paint && level.path === '' ? { background: theme.bg } : {}
    const svg = embed(emit(placed, routed, spec, cfg, theme, { flow: flowIndex(spec), ...background }), at, inner)
    const audit = emptyAudit()
    addAudit(audit, report)
    for (const pic of inner.values()) addAudit(audit, pic.audit)
    pics.set(level.path, {
      svg,
      w: Math.round(Math.max(placed.size.w, routed.size.w) + 16),
      h: Math.round(Math.max(placed.size.h, routed.size.h) + 16),
      hosts: at,
      levels: 1 + [...inner.values()].reduce((n, p) => n + p.levels, 0),
      nodes: spec.nodes.length + [...inner.values()].reduce((n, p) => n + p.nodes, 0),
      edges: spec.edges.length + [...inner.values()].reduce((n, p) => n + p.edges, 0),
      audit,
    })
  }
  const root = pics.get('')
  return root ?? { svg: '', w: 0, h: 0, hosts: new Map(), levels: 0, nodes: 0, edges: 0, audit: emptyAudit() }
}

/** The nested picture shaped like a level render, so the viewer and the CLI take it unchanged. */
export function nestedLevel(model: Model, theme: Theme = DARK, paint = false): RenderedLevel {
  const pic = nestedPicture(model, theme, paint)
  return { path: 'full', title: 'Every level', svg: pic.svg, audit: { ...pic.audit, aspect: round2(pic.w / Math.max(1, pic.h)) } }
}

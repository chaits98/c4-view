/**
 * Label chips — a chip sits ON its wire, never beside it.
 *
 * A chip is only ever moved along the horizontal runs of its own route, so the
 * label can never detach from the edge it names. When every candidate collides
 * the first one wins and the audit reports it: no invented positions.
 *
 * @module c4-view/layout/labels
 */
import type { Box, LayoutConfig, Measure, Placed, Point, Route } from '../types.ts'
import { compareKeys } from './geometry.ts'

const EPS = 0.5
const CHIP_H = 18
/** the audit gates chip∩node / chip∩chip on overlap area > 0.5, so match it */
const MIN_OVERLAP = 0.5

const hits = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) >= MIN_OVERLAP &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) >= MIN_OVERLAP

/** Chip against chip: every overlap counts, however small, because that is what the audit counts. */
const touches = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.05 &&
  Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.05

interface Run {
  /** which way the run travels; a chip slides ALONG it and straddles it across */
  axis: 'h' | 'v'
  /** the run's fixed coordinate: its y when horizontal, its x when vertical */
  at: number
  from: number
  to: number
  len: number
}

/** Which way the polyline mostly travels: the axis a chip has room to slide along. */
function longestAxis(pts: Point[]): 'h' | 'v' {
  let horizontal = 0
  let vertical = 0
  for (let i = 0; i < pts.length - 1; i += 1) {
    const dx = Math.abs(pts[i + 1].x - pts[i].x)
    const dy = Math.abs(pts[i + 1].y - pts[i].y)
    if (dy < EPS) horizontal += dx
    else if (dx < EPS) vertical += dy
  }
  return vertical > horizontal ? 'v' : 'h'
}

/** One straight segment as a run, or nothing when it does not travel along `axis`. */
function runOf(a: Point, b: Point, axis: 'h' | 'v'): Run | null {
  const flat = Math.abs(a.y - b.y) < EPS
  const upright = Math.abs(a.x - b.x) < EPS
  if (axis === 'h' ? !flat : !upright) return null
  const from = axis === 'h' ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
  const to = axis === 'h' ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
  if (to - from <= EPS) return null // coverage:invariant — a zero-length segment is not a run, and points repeat
  return { axis, at: axis === 'h' ? a.y : a.x, from, to, len: to - from }
}

/**
 * The runs a chip can sit on, longest first.
 *
 * A picture laid out top to bottom has vertical wires, and a chip is text — it stays horizontal. So the run a
 * chip rides changes with the layout, and picking only horizontal runs left every chip with a single candidate
 * at the wire's first point, which put it on top of a box.
 */
function runsOf(pts: Point[]): Run[] {
  const axis = longestAxis(pts)
  const runs: Run[] = []
  for (let i = 0; i < pts.length - 1; i += 1) {
    const run = runOf(pts[i], pts[i + 1], axis)
    if (run) runs.push(run)
  }
  return runs.sort((a, b) => b.len - a.len)
}

/**
 * Run midpoint, then ±0.6w steps, each clamped so the chip stays on the run.
 *
 * A chip wider than its run has no legal centre inside it: keep the centre on
 * the run and let the box overhang, then sweep the run coarsely so the overhang
 * can still land in the gutter instead of on a node.
 */
const SPREADS = [1, 2, 3] as const

/** Positions along a run to try, in order: centre, near-centre, then a sweep sized to the chips it holds. */
function slots(run: Run, need: number): number[] {
  const fits = run.len >= need
  const lo = fits ? run.from + need / 2 : run.from
  const hi = fits ? run.to - need / 2 : run.to
  const clamp = (t: number): number => Math.min(hi, Math.max(lo, t))
  const mid = (run.from + run.to) / 2
  const near = SPREADS.flatMap((step) => [mid + need * 0.6 * step, mid - need * 0.6 * step])
  // a vertical run is slid along in chip-heights: 9 coarse steps leave gaps a chip can fall between
  const steps = run.axis === 'v' ? Math.max(9, Math.floor(run.len / (CHIP_H + 4))) : 8
  const coarse = Array.from({ length: steps + 1 }, (_, i) => run.from + (run.len * i) / steps)
  return [mid, ...near, ...coarse].map(clamp)
}

/** Centres along the run, in the orientation the run travels. */
function alongRun(run: Run, w: number): Point[] {
  // along a vertical run the chip slides in y, so it needs its HEIGHT of room, not its width
  const need = run.axis === 'h' ? w : CHIP_H
  return slots(run, need).map((t) => (run.axis === 'h' ? { x: t, y: run.at } : { x: run.at, y: t }))
}

/**
 * Centres beside the run. A vertical run can be too short for two chips to stack on it, so this is the escape
 * hatch for an upright picture. Horizontal runs are left exactly as they were: that placement is tuned and its
 * goldens are frozen.
 */
function besideRun(run: Run, w: number): Point[] {
  if (run.axis !== 'v') return []
  const across = w / 2 + 6
  return [-1, 1].flatMap((side) => slots(run, CHIP_H).map((t) => ({ x: run.at + side * across, y: t })))
}

function candidates(pts: Point[], w: number): Point[] {
  const out = runsOf(pts).flatMap((run) => [...alongRun(run, w), ...besideRun(run, w)])
  // a route with no run — or no points at all — still needs one candidate, or the caller indexes undefined
  // and the whole page dies on a malformed route
  if (!out.length) out.push({ x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0 })
  return out
}

/** The box for one candidate centre. */
const boxAt = (c: Point, w: number): Box => ({ x: c.x - w / 2, y: c.y - CHIP_H / 2, w, h: CHIP_H })

/** First candidate that hits neither a placed chip nor a node; the first candidate otherwise. */
function pickBox(pts: Point[], w: number, chips: Box[], nodes: Box[]): Box {
  const cands = candidates(pts, w)
  const free = cands.find((c) => {
    const box = boxAt(c, w)
    return !chips.some((o) => touches(o, box)) && !nodes.some((o) => hits(o, box))
  })
  return boxAt(free ?? cands[0], w)
}

/** Fill every label's box. Chips are placed widest first, never dropped. */
export function placeLabels(routes: Route[], placed: Placed, cfg: LayoutConfig, m: Measure): Route[] {
  const size = cfg.fontSize - 1
  const nodes = [...placed.boxes.values()]
  const chips: Box[] = []
  const boxes = new Map<string, Box>()
  const widthOf = new Map(routes.map((r) => [r.key, r.label ? m.width(r.label.text, size) + 12 : 0]))

  // first-fit decreasing by chip width, ties by key: a wide chip has fewer legal
  // spots than a narrow one, so key order alone lets a narrow chip block it
  const ordered = [...routes].sort(
    (a, b) =>
      (widthOf.get(b.key) ?? 0) - (widthOf.get(a.key) ?? 0) || compareKeys(a.key, b.key),
  )
  for (const route of ordered) {
    if (!route.label) continue
    const box = pickBox(route.pts, widthOf.get(route.key) ?? 0, chips, nodes)
    chips.push(box)
    boxes.set(route.key, box)
  }

  return routes.map((route) =>
    route.label
      ? { key: route.key, pts: route.pts, label: { text: route.label.text, box: boxes.get(route.key) ?? { x: 0, y: 0, w: 0, h: 0 } } }
      : { key: route.key, pts: route.pts },
  )
}

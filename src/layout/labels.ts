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

interface Run {
  y: number
  x1: number
  x2: number
  len: number
}

/** Horizontal runs of the polyline, longest first. */
function runsOf(pts: Point[]): Run[] {
  const runs: Run[] = []
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]
    const b = pts[i + 1]
    if (Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS) {
      runs.push({
        y: (a.y + b.y) / 2,
        x1: Math.min(a.x, b.x),
        x2: Math.max(a.x, b.x),
        len: Math.abs(a.x - b.x),
      })
    }
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

function candidates(pts: Point[], w: number): Point[] {
  const out: Point[] = []
  for (const run of runsOf(pts)) {
    const mid = (run.x1 + run.x2) / 2
    const fits = run.len >= w
    const lo = fits ? run.x1 + w / 2 : run.x1
    const hi = fits ? run.x2 - w / 2 : run.x2
    const at = (x: number): Point => ({ x: Math.min(hi, Math.max(lo, x)), y: run.y })
    out.push(at(mid))
    // near the centre first (±0.6w, ±1.2w, ±1.8w), then a coarse sweep of the whole run
    const near = SPREADS.flatMap((step) => [mid + w * 0.6 * step, mid - w * 0.6 * step]).map(at)
    const coarse = Array.from({ length: 9 }, (_, i) => at(run.x1 + (run.len * i) / 8))
    out.push(...near, ...coarse)
  }
  if (!out.length && pts.length) out.push({ x: pts[0].x, y: pts[0].y })
  return out
}

/** The box for one candidate centre. */
const boxAt = (c: Point, w: number): Box => ({ x: c.x - w / 2, y: c.y - CHIP_H / 2, w, h: CHIP_H })

/** First candidate that hits neither a placed chip nor a node; the first candidate otherwise. */
function pickBox(pts: Point[], w: number, chips: Box[], nodes: Box[]): Box {
  const cands = candidates(pts, w)
  const free = cands.find((c) => {
    const box = boxAt(c, w)
    return !chips.some((o) => hits(o, box)) && !nodes.some((o) => hits(o, box))
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

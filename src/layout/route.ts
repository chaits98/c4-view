/**
 * Routing — orthogonal wires that live only in the gutters (and, for a backward
 * edge, in the return corridor below the drawing).
 *
 * One track per jog, allocated per gutter and keyed by chain, is what makes the
 * "no two wires share a collinear segment" promise hold by construction rather
 * than by luck. The corridor and the ports live in their own modules.
 *
 * @module c4-view/layout/route
 */
import type { Chain, LayoutConfig, Measure, Placed, PlacedItem, Point, Route, Routed } from '../types.ts'
import { placeLabels } from './labels.ts'
import { EPS, CORRIDOR_PAD, round1 } from './geometry.ts'
import { buildPorts, portY } from './ports.ts'
import { planBackward, type Back } from './backward.ts'

/** left/right border of an item; a dummy is a point on the corridor at its own x */
const edgeX = (it: PlacedItem, side: 'l' | 'r'): number => (it.dummy || side === 'l' ? it.x : it.x + it.w)

interface Piece { x0: number; x1: number; y0: number; y1: number; gutter: number }
interface Jog { key: string; y0: number; y1: number }

/** Horizontal extent of one rank's column. A dummy-only rank (a rank hint can leave
 *  one) still has a position: its dummies sit on the column, so their x is the extent.
 *  Returning {0,0} there collapsed every track in its gutters to x=24 and the wire
 *  looped back across the drawing — 95.5px through its own source node, audited OK. */
function rankEdges(placed: Placed, r: number, depth = 0): { left: number; right: number } {
  let left = Infinity
  let right = -Infinity
  for (const it of placed.items.values()) {
    if (it.rank !== r) continue
    if (it.dummy) {
      left = Math.min(left, it.x)
      right = Math.max(right, it.x)
      continue
    }
    left = Math.min(left, it.x)
    right = Math.max(right, it.x + it.w)
  }
  if (Number.isFinite(left)) return { left, right }
  if (depth > 2) return { left: 0, right: 0 }
  // nothing at all on this rank: borrow the nearest rank that has something
  const ranks = [...new Set([...placed.items.values()].map((it) => it.rank))].sort((a, b) => a - b)
  const ref = ranks.filter((x) => x < r).pop() ?? ranks.find((x) => x > r)
  return ref === undefined ? { left: 0, right: 0 } : rankEdges(placed, ref, depth + 1)
}

/**
 * Track order for one gutter. Distinct tracks stop two jogs sharing a vertical;
 * horizontally two runs still collide when a left stub at y meets a right stub
 * at that y and the left one's track sits to the right. So a chain leaving at y
 * owns a smaller track than a chain arriving at y: Kahn over those precedences,
 * ties by key, and a cycle falls back to key order rather than looping.
 */
function orderJogs(jogs: Jog[]): string[] {
  const keys = [...new Set(jogs.map((j) => j.key))].sort()
  const preds = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]))
  for (const p of jogs) for (const q of jogs) if (p.key !== q.key && Math.abs(p.y0 - q.y1) < EPS) preds.get(q.key)?.add(p.key)
  const left = new Set(keys)
  const order: string[] = []
  while (left.size) {
    const sorted = [...left].sort()
    // ponytail: O(n^2) per gutter; a gutter holds a handful of jogs, not thousands
    const next = sorted.find((k) => [...(preds.get(k) ?? [])].every((p) => !left.has(p))) ?? sorted[0]
    order.push(next)
    left.delete(next)
  }
  return order
}

/** `tx` per gutter per chain: one distinct track inside the gutter, or evenly spread. */
function allocateTracks(placed: Placed, cfg: LayoutConfig, joggers: Map<number, Jog[]>): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>()
  for (const [gutter, jogs] of joggers) {
    const left = rankEdges(placed, gutter).right
    const right = rankEdges(placed, gutter + 1).left
    const order = orderJogs(jogs)
    // 2 lanes of clearance from the column edge: a track hugging a box reads as "through it"
    const base = order.map((_, i) => left + cfg.lane * (i + 2))
    const fits = base.every((tx) => tx <= right - cfg.lane * 2)
    const lo = left + cfg.lane * 2
    const span = right - cfg.lane - lo
    const tracks = new Map<string, number>()
    order.forEach((key, i) => {
      const even = span > 0 ? lo + (span * (i + 1)) / (order.length + 1) : left + cfg.lane * (i + 2)
      tracks.set(key, fits ? base[i] : even)
    })
    out.set(gutter, tracks)
  }
  return out
}


/** Pass 1 — one piece per chain hop, and the gutters that need a jog track. */
function planPieces(chainList: Chain[], items: Map<string, PlacedItem>, ports: Map<string, number>):
  { pieces: Map<string, Piece[]>; joggers: Map<number, Jog[]> } {
  const pieces = new Map<string, Piece[]>()
  const joggers = new Map<number, Jog[]>()
  for (const c of chainList) {
    if (c.backward) continue
    const list: Piece[] = []
    for (let i = 0; i < c.items.length - 1; i += 1) {
      const a = items.get(c.items[i])
      const b = items.get(c.items[i + 1])
      if (!a || !b) continue
      const piece: Piece = {
        x0: edgeX(a, 'r'),
        x1: edgeX(b, 'l'),
        y0: portY(a, 'r', c.key, ports),
        y1: portY(b, 'l', c.key, ports),
        gutter: a.rank,
      }
      if (Math.abs(piece.y0 - piece.y1) >= EPS) {
        joggers.set(piece.gutter, [...(joggers.get(piece.gutter) ?? []), { key: c.key, y0: piece.y0, y1: piece.y1 }])
      }
      list.push(piece)
    }
    pieces.set(c.key, list)
  }
  return { pieces, joggers }
}

/** Pass 2 — one polyline per chain: horizontals at port y, verticals at track x. */
function buildPolyline(c: Chain, pieces: Piece[], tracks: Map<number, Map<string, number>>, back: Back | undefined): Point[] {
  const pts: Point[] = []
  const push = (x: number, y: number): void => {
    const p = { x: round1(x), y: round1(y) }
    const last = pts[pts.length - 1]
    if (last && last.x === p.x && last.y === p.y) return
    pts.push(p)
  }

  if (back) {
    const spine: Array<[number, number]> = [
      [back.sx, back.sy], [back.sx, back.exit], [back.gx, back.exit], [back.gx, back.row],
      [back.rx, back.row], [back.rx, back.ty], [back.px, back.ty],
    ]
    for (const [x, y] of spine) push(x, y)
    return pts
  }

  for (const p of pieces) {
    if (Math.abs(p.y0 - p.y1) < EPS) {
      push(p.x0, p.y0)
      push(p.x1, p.y1)
      continue
    }
    const tx = tracks.get(p.gutter)?.get(c.key) ?? p.x0
    push(p.x0, p.y0)
    push(tx, p.y0)
    push(tx, p.y1)
    push(p.x1, p.y1)
  }
  return pts
}

export function route(placed: Placed, cfg: LayoutConfig, m: Measure): Routed {
  const ports = buildPorts(placed.chains, placed.items)
  const { pieces, joggers } = planPieces(placed.chains, placed.items, ports)
  const tracks = allocateTracks(placed, cfg, joggers)
  const backs = planBackward(placed, cfg, ports, tracks)

  const routes: Route[] = placed.chains.map((c) => {
    const pts = buildPolyline(c, pieces.get(c.key) ?? [], tracks, backs.get(c.key))
    // a zero box is a placeholder: placeLabels owns every real chip position
    return c.label
      ? { key: c.key, pts, label: { text: c.label, box: { x: 0, y: 0, w: 0, h: 0 } } }
      : { key: c.key, pts }
  })

  const lastRow = backs.size ? placed.size.h + CORRIDOR_PAD + (backs.size - 1) * (cfg.lane + 4) : 0
  const size = { w: placed.size.w, h: Math.max(placed.size.h, lastRow + cfg.lane) }
  return { routes: placeLabels(routes, placed, cfg, m), size }
}

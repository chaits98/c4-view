/**
 * Routing — orthogonal wires that live only in the gutters (and, for a backward
 * edge, in the return corridor below the drawing).
 *
 * One track per jog, allocated per gutter and keyed by chain, is what makes the
 * "no two wires share a collinear segment" promise hold by construction rather
 * than by luck.
 *
 * @module c4-view/layout/route
 */
import type { Chain, LayoutConfig, Measure, Placed, PlacedItem, Point, Route, Routed } from '../types.ts'
import { placeLabels } from './labels.ts'

const EPS = 0.5
/** first corridor row sits this far below the drawing */
const CORRIDOR_PAD = 18
const SEP = '\u0001'

const round1 = (n: number): number => Math.round(n * 10) / 10
const centreY = (it: PlacedItem): number => it.y + it.h / 2
const centreX = (it: PlacedItem): number => it.x + it.w / 2
const portKey = (chainKey: string, id: string, side: string): string => `${chainKey}${SEP}${id}${SEP}${side}`
/** left/right border of an item; a dummy is a point on the corridor at its own x */
const edgeX = (it: PlacedItem, side: 'l' | 'r'): number => (it.dummy || side === 'l' ? it.x : it.x + it.w)

/** One chain touching one item side; `other` is the far end's centre, for port order. */
interface Touch { key: string; other: number }
interface Piece { x0: number; x1: number; y0: number; y1: number; gutter: number }
interface Jog { key: string; y0: number; y1: number }
interface Back { sx: number; sy: number; exit: number; gx: number; row: number; rx: number; ty: number; px: number }

/** Port y (sides l/r) and port x (bottom) for every chain touching a real item. */
function buildPorts(chains: Chain[], items: Map<string, PlacedItem>): Map<string, number> {
  const groups = new Map<string, Touch[]>()
  const add = (chainKey: string, id: string, side: string, other: number): void => {
    const k = `${id}${SEP}${side}`
    const list = groups.get(k) ?? []
    list.push({ key: chainKey, other })
    groups.set(k, list)
  }
  for (const c of chains) {
    const first = items.get(c.items[0])
    const last = items.get(c.items[c.items.length - 1])
    if (!first || !last) continue
    if (c.backward) {
      add(c.key, first.id, 'b', centreX(last))
      add(c.key, last.id, 'b', centreX(first))
    } else {
      add(c.key, first.id, 'r', centreY(last))
      add(c.key, last.id, 'l', centreY(first))
    }
  }

  const ports = new Map<string, number>()
  for (const [k, list] of groups) {
    const [id, side] = k.split(SEP)
    const it = items.get(id)
    if (!it) continue
    const sorted = [...list].sort((a, b) => a.other - b.other || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    sorted.forEach((t, i) => {
      const frac = (i + 1) / (sorted.length + 1)
      ports.set(portKey(t.key, id, side), side === 'b' ? it.x + frac * it.w : it.y + frac * it.h)
    })
  }
  return ports
}

const portY = (it: PlacedItem, side: 'l' | 'r', key: string, ports: Map<string, number>): number =>
  it.dummy ? centreY(it) : (ports.get(portKey(key, it.id, side)) ?? centreY(it))

const portX = (it: PlacedItem, key: string, ports: Map<string, number>): number =>
  it.dummy ? centreX(it) : (ports.get(portKey(key, it.id, 'b')) ?? centreX(it))

/** Horizontal extent of one rank's column. Every rank holds at least one real node. */
function rankEdges(placed: Placed, r: number): { left: number; right: number } {
  let left = Infinity
  let right = -Infinity
  for (const it of placed.items.values()) {
    if (it.rank !== r || it.dummy) continue
    left = Math.min(left, it.x)
    right = Math.max(right, it.x + it.w)
  }
  return { left: Number.isFinite(left) ? left : 0, right: Number.isFinite(right) ? right : 0 }
}

/** True when a vertical run at `x` between `y1` and `y2` would cut through a node. */
function blocked(placed: Placed, x: number, y1: number, y2: number, skip: ReadonlySet<string>): boolean {
  const lo = Math.min(y1, y2)
  const hi = Math.max(y1, y2)
  for (const [id, b] of placed.boxes) {
    if (skip.has(id)) continue
    if (x > b.x + EPS && x < b.x + b.w - EPS && hi > b.y + EPS && lo < b.y + b.h - EPS) return true
  }
  return false
}

/** Middle of the free gap directly below an item — where a wire may leave its column. */
function exitY(placed: Placed, it: PlacedItem): number {
  let below = Infinity
  for (const [id, b] of placed.boxes) {
    if (id === it.id) continue
    const under = b.x < it.x + it.w - EPS && b.x + b.w > it.x + EPS && b.y >= it.y + it.h - EPS
    if (under) below = Math.min(below, b.y)
  }
  const bottom = it.y + it.h
  return Number.isFinite(below) ? (bottom + below) / 2 : bottom
}

/** A vertical track between the ranks either side of `g`, clear of every jog track. */
function gutterTrack(placed: Placed, cfg: LayoutConfig, g: number, used: Map<number, Set<number>>): number {
  let left = -Infinity
  let right = Infinity
  for (const it of placed.items.values()) {
    if (it.dummy) continue
    if (it.rank <= g) left = Math.max(left, it.x + it.w)
    if (it.rank > g) right = Math.min(right, it.x)
  }
  const taken = used.get(g) ?? new Set<number>()
  used.set(g, taken)
  for (let i = 2; i < 200; i += 1) {
    const x = left + cfg.lane * i
    if (x <= right - cfg.lane && !taken.has(x)) {
      taken.add(x)
      return x
    }
  }
  const mid = (left + right) / 2
  taken.add(mid)
  return mid
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

/**
 * Plan the return corridor. A plain drop/rise at the port cuts through every
 * node stacked below that port in the same column, so a blocked side leaves the
 * column through the gap below it and travels in a gutter instead.
 */
function planBackward(placed: Placed, cfg: LayoutConfig, ports: Map<string, number>, tracks: Map<number, Map<string, number>>): Map<string, Back> {
  const items = placed.items
  const lastRank = Math.max(...[...items.values()].map((it) => it.rank))
  const used = new Map<number, Set<number>>()
  for (const [g, t] of tracks) used.set(g, new Set(t.values()))
  const chains = placed.chains.filter((c) => c.backward).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const out = new Map<string, Back>()
  chains.forEach((c, k) => {
    const src = items.get(c.items[0])
    const dst = items.get(c.items[c.items.length - 1])
    if (!src || !dst) return
    const row = placed.size.h + CORRIDOR_PAD + k * (cfg.lane + 4)
    const sx = portX(src, c.key, ports)
    const sy = src.y + src.h
    const px = portX(dst, c.key, ports)
    const ty = dst.y + dst.h
    const skip = new Set([src.id, dst.id])
    const exit = blocked(placed, sx, sy, row, skip) ? exitY(placed, src) : sy
    const dropG = src.rank > 0 ? src.rank - 1 : src.rank
    const riseG = dst.rank < lastRank ? dst.rank : Math.max(0, dst.rank - 1)
    out.set(c.key, {
      sx,
      sy,
      exit,
      gx: exit === sy ? sx : gutterTrack(placed, cfg, dropG, used),
      row,
      rx: blocked(placed, px, ty, row, skip) ? gutterTrack(placed, cfg, riseG, used) : px,
      ty,
      px,
    })
  })
  return out
}

export function route(placed: Placed, cfg: LayoutConfig, m: Measure): Routed {
  const items = placed.items
  const ports = buildPorts(placed.chains, items)

  // pass 1 — the pieces, and which gutters they need a track in
  const pieces = new Map<string, Piece[]>()
  const joggers = new Map<number, Jog[]>()
  for (const c of placed.chains) {
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
  const tracks = allocateTracks(placed, cfg, joggers)
  const backs = planBackward(placed, cfg, ports, tracks)

  // pass 2 — one polyline per chain, consecutive duplicates dropped
  const polylines = new Map<string, Point[]>()
  for (const c of placed.chains) {
    const pts: Point[] = []
    const push = (x: number, y: number): void => {
      const p = { x: round1(x), y: round1(y) }
      const last = pts[pts.length - 1]
      if (last && last.x === p.x && last.y === p.y) return
      pts.push(p)
    }

    const back = backs.get(c.key)
    if (back) {
      for (const p of [
        [back.sx, back.sy],
        [back.sx, back.exit],
        [back.gx, back.exit],
        [back.gx, back.row],
        [back.rx, back.row],
        [back.rx, back.ty],
        [back.px, back.ty],
      ]) push(p[0], p[1])
    } else {
      for (const p of pieces.get(c.key) ?? []) {
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
    }
    polylines.set(c.key, pts)
  }

  const lastRow = backs.size ? placed.size.h + CORRIDOR_PAD + (backs.size - 1) * (cfg.lane + 4) : 0
  const size = { w: placed.size.w, h: Math.max(placed.size.h, lastRow + cfg.lane) }

  const routes: Route[] = placed.chains.map((c) => {
    const pts = polylines.get(c.key) ?? []
    // a zero box is a placeholder: placeLabels owns every real chip position
    return c.label
      ? { key: c.key, pts, label: { text: c.label, box: { x: 0, y: 0, w: 0, h: 0 } } }
      : { key: c.key, pts }
  })

  return { routes: placeLabels(routes, placed, cfg, m), size }
}

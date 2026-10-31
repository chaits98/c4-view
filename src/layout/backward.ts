/**
 * The return corridor — how a backward chain (rank[to] <= rank[from]) gets home
 * without cutting through the nodes stacked under its own ends.
 *
 * A plain drop/rise at the port cut through every node below it (measured: one
 * wire∧node on the agent-org fixture), so a blocked side leaves the column through
 * the gap beneath it and travels in a gutter track instead.
 *
 * @module c4-view/layout/backward
 */
import type { Chain, LayoutConfig, Placed, PlacedItem } from '../types.ts'
import { EPS, CORRIDOR_PAD, compareKeys } from './geometry.ts'
import { portX } from './ports.ts'

export interface Back { sx: number; sy: number; exit: number; gx: number; row: number; rx: number; ty: number; px: number }

/** True when a vertical run at `x` between `y1` and `y2` would cut through a node. */
export function blocked(placed: Placed, x: number, y1: number, y2: number, skip: ReadonlySet<string>): boolean {
  const lo = Math.min(y1, y2)
  const hi = Math.max(y1, y2)
  for (const [id, b] of placed.boxes) {
    if (skip.has(id)) continue
    if (x > b.x + EPS && x < b.x + b.w - EPS && hi > b.y + EPS && lo < b.y + b.h - EPS) return true
  }
  return false
}

/** Middle of the free gap directly below an item — where a wire may leave its column. */
export function exitY(placed: Placed, it: PlacedItem): number {
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
export function gutterTrack(placed: Placed, cfg: LayoutConfig, g: number, used: Map<number, Set<number>>): number {
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
 * Plan the return corridor. A plain drop/rise at the port cuts through every
 * node stacked below that port in the same column, so a blocked side leaves the
 * column through the gap below it and travels in a gutter instead.
 */
function corridorFor(chain: Chain, k: number, ctx: {
  placed: Placed; cfg: LayoutConfig; ports: Map<string, number>; used: Map<number, Set<number>>; lastRank: number
}): Back | null {
  const { placed, cfg, ports, used, lastRank } = ctx
  const src = placed.items.get(chain.items[0])
  const dst = placed.items.get(chain.items[chain.items.length - 1])
  if (!src || !dst) return null
  const row = placed.size.h + CORRIDOR_PAD + k * (cfg.lane + 4)
  const sx = portX(src, chain.key, ports)
  const sy = src.y + src.h
  const px = portX(dst, chain.key, ports)
  const ty = dst.y + dst.h
  const skip = new Set([src.id, dst.id])
  const exit = blocked(placed, sx, sy, row, skip) ? exitY(placed, src) : sy
  const dropG = src.rank > 0 ? src.rank - 1 : src.rank
  const riseG = dst.rank < lastRank ? dst.rank : Math.max(0, dst.rank - 1)
  return {
    sx,
    sy,
    exit,
    gx: exit === sy ? sx : gutterTrack(placed, cfg, dropG, used),
    row,
    rx: blocked(placed, px, ty, row, skip) ? gutterTrack(placed, cfg, riseG, used) : px,
    ty,
    px,
  }
}

export function planBackward(placed: Placed, cfg: LayoutConfig, ports: Map<string, number>, tracks: Map<number, Map<string, number>>): Map<string, Back> {
  const used = new Map<number, Set<number>>()
  for (const [g, t] of tracks) used.set(g, new Set(t.values()))
  const lastRank = Math.max(...[...placed.items.values()].map((it) => it.rank))
  const chains = placed.chains.filter((c) => c.backward).sort((a, b) => compareKeys(a.key, b.key))
  const out = new Map<string, Back>()
  chains.forEach((chain, k) => {
    const back = corridorFor(chain, k, { placed, cfg, ports, used, lastRank })
    if (back) out.set(chain.key, back)
  })
  return out
}
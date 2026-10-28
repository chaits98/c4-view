/**
 * Placement — turns ranks of items into geometry: measures real nodes, applies
 * port pressure, sizes columns, stacks rows and boxes up boundary groups.
 *
 * Pure: reads `ranked`/`level`, returns new maps; nothing is mutated.
 *
 * @module c4-view/layout/place
 */
import type {
  Box, Chain, LayoutConfig, LevelSpec, Measure, NodeSpec, Placed, PlacedItem, Ranked, RankItem,
} from '../types.ts'
import { measureNode } from './measure-node.ts'

const round1 = (n: number): number => Math.round(n * 10) / 10
const GROUP_PAD = 16
const GROUP_STRIP = 22

/** Ports per node, in chain order: how many chains leave and how many arrive. */
function portCounts(chains: Chain[]): { out: Map<string, number>; into: Map<string, number> } {
  const out = new Map<string, number>()
  const into = new Map<string, number>()
  for (const c of chains) {
    const first = c.items[0]
    const last = c.items[c.items.length - 1]
    if (first !== undefined) out.set(first, (out.get(first) ?? 0) + 1)
    if (last !== undefined) into.set(last, (into.get(last) ?? 0) + 1)
  }
  return { out, into }
}

/** Size one item: measured node (port-pressure-tall), or the dummy reservations. */
function sizeItem(item: RankItem, specs: Map<string, NodeSpec>,
  ports: { out: Map<string, number>; into: Map<string, number> }, cfg: LayoutConfig, m: Measure):
  { w: number; h: number } {
  if (item.dummy) return { w: item.w, h: item.h }
  const node = specs.get(item.id)
  if (!node) return { w: item.w, h: item.h }
  const t = measureNode(node, cfg, m)
  const p = Math.max(ports.out.get(item.id) ?? 0, ports.into.get(item.id) ?? 0)
  return { w: Math.ceil(t.w), h: Math.ceil(Math.max(t.h, (p + 1) * cfg.portGap)) }
}

/** Group box: member bbox + padding all round + a label strip on top. */
function groupBox(members: Box[]): Box {
  const x0 = Math.min(...members.map((b) => b.x))
  const y0 = Math.min(...members.map((b) => b.y))
  const x1 = Math.max(...members.map((b) => b.x + b.w))
  const y1 = Math.max(...members.map((b) => b.y + b.h))
  return {
    x: round1(x0 - GROUP_PAD),
    y: round1(y0 - GROUP_PAD - GROUP_STRIP),
    w: round1(x1 - x0 + 2 * GROUP_PAD),
    h: round1(y1 - y0 + 2 * GROUP_PAD + GROUP_STRIP),
  }
}

/** Chains crossing each gutter — the gutter must be wide enough to give each one a track. */
function gutterLoad(ranked: Ranked): number[] {
  const load = new Array<number>(ranked.ranks.length).fill(0)
  for (const c of ranked.chains) {
    if (c.backward) continue
    for (let i = 0; i < c.items.length - 1; i += 1) {
      const a = ranked.items.get(c.items[i])
      const b = ranked.items.get(c.items[i + 1])
      if (a && b && b.rank === a.rank + 1) load[a.rank] += 1
    }
  }
  return load
}

/** Place measured items into columns/rows; emit node boxes, item points, group boxes. */
export function place(ranked: Ranked, level: LevelSpec, cfg: LayoutConfig, m: Measure): Placed {
  const specs = new Map<string, NodeSpec>()
  for (const n of level.nodes) specs.set(n.id, n)
  const ports = portCounts(ranked.chains)

  const ranks = ranked.ranks
  const sizes = new Map<string, { w: number; h: number }>()
  const W: number[] = []
  for (let r = 0; r < ranks.length; r++) {
    let col = 0
    for (const id of ranks[r]) {
      const item = ranked.items.get(id)
      if (!item) continue
      const s = sizeItem(item, specs, ports, cfg, m)
      sizes.set(id, s)
      if (!item.dummy && s.w > col) col = s.w
    }
    W[r] = col
  }

  const x: number[] = []
  const load = gutterLoad(ranked)
  let cursorX = 0
  for (let r = 0; r < ranks.length; r += 1) {
    x[r] = cursorX
    // a gutter carries one track per chain crossing it, one lane apart: rankGap is the floor,
    // the wire load is the truth (measured failure: 12 chains in a 120u gutter overflowed)
    const gap = Math.max(cfg.rankGap, cfg.lane * ((load[r] ?? 0) + 4))
    cursorX += W[r] + gap
  }

  // rows: stack per rank, lane-thin gap next to a dummy, then centre the column
  const ys = new Map<string, number>()
  const rankH: number[] = []
  for (let r = 0; r < ranks.length; r++) {
    const ids = ranks[r]
    let cursor = 0
    let extent = 0
    for (let i = 0; i < ids.length; i++) {
      const s = sizes.get(ids[i])
      if (!s) continue
      ys.set(ids[i], cursor)
      extent = cursor + s.h
      const thisDummy = ranked.items.get(ids[i])?.dummy ?? false
      const next = ids[i + 1]
      const nextDummy = next !== undefined && (ranked.items.get(next)?.dummy ?? false)
      cursor += s.h + (thisDummy || nextDummy ? cfg.lane : cfg.nodeGap)
    }
    rankH[r] = extent
  }
  const maxH = rankH.length ? Math.max(...rankH) : 0

  const items = new Map<string, PlacedItem>()
  for (let r = 0; r < ranks.length; r++) {
    const dy = (maxH - rankH[r]) / 2
    for (const id of ranks[r]) {
      const src = ranked.items.get(id)
      const s = sizes.get(id)
      if (!src || !s) continue
      const px = src.dummy ? x[r] + W[r] / 2 : x[r] + (W[r] - s.w) / 2
      items.set(id, { ...src, w: s.w, h: s.h, x: round1(px), y: round1((ys.get(id) ?? 0) + dy) })
    }
  }

  const boxes = new Map<string, Box>()
  for (const [id, it] of items) {
    if (!it.dummy) boxes.set(id, { x: it.x, y: it.y, w: it.w, h: it.h })
  }

  const groups: Placed['groups'] = []
  for (const g of level.groups ?? []) {
    const members = g.members.flatMap((id) => {
      const b = boxes.get(id)
      return b ? [b] : []
    })
    if (!members.length) continue
    groups.push({ id: g.id, label: g.label, box: groupBox(members) })
  }

  // A boundary box reaches 16u past its members and 22u above them, so the drawing can start
  // negative. Normalise instead of clipping: shift everything so the top-left is (0,0) and the
  // size covers the boundary too.
  let minX = 0
  let minY = 0
  let maxX = ranks.length ? x[ranks.length - 1] + W[ranks.length - 1] : 0
  let maxY = maxH
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  for (const g of groups) {
    minX = Math.min(minX, g.box.x)
    minY = Math.min(minY, g.box.y)
    maxX = Math.max(maxX, g.box.x + g.box.w)
    maxY = Math.max(maxY, g.box.y + g.box.h)
  }
  if (minX < 0 || minY < 0) {
    const dx = -minX
    const dy = -minY
    for (const [id, it] of items) items.set(id, { ...it, x: round1(it.x + dx), y: round1(it.y + dy) })
    for (const [id, b] of boxes) boxes.set(id, { ...b, x: round1(b.x + dx), y: round1(b.y + dy) })
    for (const g of groups) g.box = { ...g.box, x: round1(g.box.x + dx), y: round1(g.box.y + dy) }
  }

  const size = { w: round1(maxX - minX), h: round1(maxY - minY) }
  return { items, chains: ranked.chains, boxes, groups, size }
}

/**
 * Placement — turns ranks of items into geometry: measures real nodes, applies
 * port pressure, sizes columns, stacks rows and boxes up boundary groups.
 *
 * Pure: reads `ranked`/`level`, returns new maps; nothing is mutated.
 *
 * @module c4-view/layout/place
 */
import type { Box, Chain, LayoutConfig, LevelSpec, Measure, NodeSpec, Placed, PlacedItem, Ranked, RankItem } from '../types.ts'
import { measureNode } from './measure-node.ts'
import { round1 } from './geometry.ts'

const GROUP_PAD = 16
const GROUP_STRIP = 22

interface Sizes { w: number; h: number }
interface Ports { out: Map<string, number>; into: Map<string, number> }
interface Row { ys: Map<string, number>; heights: number[]; max: number }

/** Ports per node, in chain order: how many chains leave and how many arrive. */
function portCounts(chains: Chain[]): Ports {
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
function sizeItem(item: RankItem, specs: Map<string, NodeSpec>, ports: Ports, cfg: LayoutConfig, m: Measure): Sizes {
  if (item.dummy) return { w: item.w, h: item.h }
  const node = specs.get(item.id)
  if (!node) return { w: item.w, h: item.h }
  // the nested renderer sizes a host box to the picture it holds, so that box is already measured
  if (node.w !== undefined && node.h !== undefined) return { w: node.w, h: node.h }
  const t = measureNode(node, cfg, m)
  const p = Math.max(ports.out.get(item.id) ?? 0, ports.into.get(item.id) ?? 0)
  const box = { w: Math.ceil(t.w), h: Math.ceil(Math.max(t.h, (p + 1) * cfg.portGap)) }
  // A top-to-bottom drawing is laid out left-to-right and then transposed, so the space a node needs is
  // claimed on the other axis: reserve its text width as height here, and the transpose hands it back as
  // width. Without this the box ends up as wide as a row is tall and the label hangs out of it.
  return cfg.direction === 'TB' ? { w: box.h, h: box.w } : box
}

/**
 * What each gutter has to hold: one track per crossing chain, and the widest label chip
 * riding one of them. A gutter that cannot fit its own label pushes the chip onto a node
 * (measured: a 150px chip on a 120px run overlapped both boxes).
 */
function gutterLoad(ranked: Ranked, cfg: LayoutConfig, m: Measure): { chains: number[]; chip: number[] } {
  const chains = new Array<number>(ranked.ranks.length).fill(0)
  const chip = new Array<number>(ranked.ranks.length).fill(0)
  for (const c of ranked.chains) {
    if (c.backward) continue
    const label = c.label ? m.width(c.label, Math.max(9, cfg.fontSize - 1)) + 12 : 0
    for (let i = 0; i < c.items.length - 1; i += 1) {
      const a = ranked.items.get(c.items[i])
      const b = ranked.items.get(c.items[i + 1])
      if (!a || !b || b.rank !== a.rank + 1) continue
      chains[a.rank] += 1
      chip[a.rank] = Math.max(chip[a.rank], label)
    }
  }
  return { chains, chip }
}

/** Measure every item once and derive each column's width. */
function sizeColumns(ranked: Ranked, specs: Map<string, NodeSpec>, ports: Ports, cfg: LayoutConfig, m: Measure):
  { sizes: Map<string, Sizes>; W: number[] } {
  const sizes = new Map<string, Sizes>()
  const W: number[] = []
  ranked.ranks.forEach((ids, r) => {
    let column = 0
    for (const id of ids) {
      const item = ranked.items.get(id)
      if (!item) continue
      const s = sizeItem(item, specs, ports, cfg, m)
      sizes.set(id, s)
      if (!item.dummy && s.w > column) column = s.w
    }
    W[r] = column
  })
  return { sizes, W }
}

/** Column origins: the gap after each rank is set by its wire load and its widest chip. */
function columnXs(W: number[], load: { chains: number[]; chip: number[] }, cfg: LayoutConfig): number[] {
  const x: number[] = []
  let cursor = 0
  W.forEach((width, r) => {
    x[r] = cursor
    const gap = Math.max(cfg.rankGap, cfg.lane * ((load.chains[r] ?? 0) + 4), (load.chip[r] ?? 0) + 2 * cfg.lane)
    cursor += width + gap
  })
  return x
}

/** Rows: stack per rank, a lane-thin gap next to a dummy, and record each rank's height. */
function stackRows(ranked: Ranked, sizes: Map<string, Sizes>, cfg: LayoutConfig): Row {
  const ys = new Map<string, number>()
  const heights: number[] = []
  ranked.ranks.forEach((ids, r) => {
    let cursor = 0
    let extent = 0
    ids.forEach((id, i) => {
      const s = sizes.get(id)
      if (!s) return
      ys.set(id, cursor)
      extent = cursor + s.h
      const dummy = ranked.items.get(id)?.dummy ?? false
      const next = ids[i + 1]
      const nextDummy = next !== undefined && (ranked.items.get(next)?.dummy ?? false)
      cursor += s.h + (dummy || nextDummy ? cfg.lane : cfg.nodeGap)
    })
    heights[r] = extent
  })
  return { ys, heights, max: heights.length ? Math.max(...heights) : 0 }
}

/** Absolute item boxes: a column is centred, a rank is centred vertically. */
function buildItems(ranked: Ranked, sizes: Map<string, Sizes>, row: Row, W: number[], x: number[]): Map<string, PlacedItem> {
  const items = new Map<string, PlacedItem>()
  ranked.ranks.forEach((ids, r) => {
    const dy = (row.max - row.heights[r]) / 2
    for (const id of ids) {
      const src = ranked.items.get(id)
      const s = sizes.get(id)
      if (!src || !s) continue
      const px = src.dummy ? x[r] + W[r] / 2 : x[r] + (W[r] - s.w) / 2
      items.set(id, { ...src, w: s.w, h: s.h, x: round1(px), y: round1((row.ys.get(id) ?? 0) + dy) })
    }
  })
  return items
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

function groupBoxes(level: LevelSpec, boxes: Map<string, Box>): Placed['groups'] {
  return (level.groups ?? []).flatMap((g) => {
    const members = g.members.flatMap((id) => {
      const b = boxes.get(id)
      return b ? [b] : []
    })
    return members.length ? [{ id: g.id, label: g.label, box: groupBox(members) }] : []
  })
}

/**
 * A boundary box reaches 16u past its members and 22u above them, so the drawing can start
 * negative. Normalise instead of clipping: shift everything so the top-left is (0,0).
 */
function normalise(items: Map<string, PlacedItem>, boxes: Map<string, Box>, groups: Placed['groups'],
  base: { w: number; h: number }): { w: number; h: number } {
  let minX = 0
  let minY = 0
  let maxX = base.w
  let maxY = base.h
  for (const b of [...boxes.values(), ...groups.map((g) => g.box)]) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (minX < 0 || minY < 0) {
    for (const [id, it] of items) items.set(id, { ...it, x: round1(it.x - minX), y: round1(it.y - minY) })
    for (const [id, b] of boxes) boxes.set(id, { ...b, x: round1(b.x - minX), y: round1(b.y - minY) })
    for (const g of groups) g.box = { ...g.box, x: round1(g.box.x - minX), y: round1(g.box.y - minY) }
  }
  return { w: round1(maxX - minX), h: round1(maxY - minY) }
}

/** Place measured items into columns/rows; emit node boxes, item points, group boxes. */
export function place(ranked: Ranked, level: LevelSpec, cfg: LayoutConfig, m: Measure): Placed {
  const specs = new Map(level.nodes.map((n) => [n.id, n] as const))
  const ports = portCounts(ranked.chains)
  const { sizes, W } = sizeColumns(ranked, specs, ports, cfg, m)
  const x = columnXs(W, gutterLoad(ranked, cfg, m), cfg)
  const row = stackRows(ranked, sizes, cfg)
  const items = buildItems(ranked, sizes, row, W, x)

  const boxes = new Map<string, Box>()
  for (const [id, it] of items) if (!it.dummy) boxes.set(id, { x: it.x, y: it.y, w: it.w, h: it.h })
  const groups = groupBoxes(level, boxes)
  const last = W.length - 1
  const size = normalise(items, boxes, groups, { w: last >= 0 ? x[last] + W[last] : 0, h: row.max })
  return { items, chains: ranked.chains, boxes, groups, size }
}

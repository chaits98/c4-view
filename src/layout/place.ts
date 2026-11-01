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
import { BAND_GAP, round1 } from './geometry.ts'

const GROUP_PAD = 16
const GROUP_STRIP = 22

interface Sizes { w: number; h: number }

/** One row of columns: consecutive ranks whose combined width fits `rowWidth`. */
interface Band { ranks: number[]; width: number }


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
  const t = measureNode(node, cfg, m)
  const p = Math.max(ports.out.get(item.id) ?? 0, ports.into.get(item.id) ?? 0)
  return { w: Math.ceil(t.w), h: Math.ceil(Math.max(t.h, (p + 1) * cfg.portGap)) }
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

/**
 * Split the columns into rows. A row takes the next rank while it still fits `rowWidth`; the first rank of
 * every row starts at the same x, so the rows read left to right like one strip folded into paragraphs.
 */
function bandRows(W: number[], x: number[], rowWidth: number): Band[] {
  const bands: Band[] = []
  let current: number[] = []
  let start = 0
  W.forEach((width, r) => {
    const right = x[r] + width
    if (current.length && rowWidth > 0 && right - start > rowWidth) {
      bands.push({ ranks: current, width: start === 0 ? x[current[0]] + W[current[0]] : 0 })
      bands[bands.length - 1].width = x[current[current.length - 1]] + W[current[current.length - 1]] - start
      current = []
    }
    if (!current.length) start = x[r]
    current.push(r)
  })
  if (current.length) bands.push({ ranks: current, width: x[current[current.length - 1]] + W[current[current.length - 1]] - start })
  return bands
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

/** Absolute item boxes: a column is centred, a rank is centred vertically inside its row of columns. */
function buildItems(ranked: Ranked, sizes: Map<string, Sizes>, row: Row, W: number[], x: number[], bands: Band[], margin: number): Map<string, PlacedItem> {
  const items = new Map<string, PlacedItem>()
  const bandOf = new Map<number, number>()
  bands.forEach((b, i) => b.ranks.forEach((r) => bandOf.set(r, i)))
  // coverage:invariant — stackRows records a height for every rank, so the fallback is for a hand-built Row
  const bandHeight = bands.map((b) => Math.max(...b.ranks.map((r) => row.heights[r] ?? 0)))
  const top: number[] = []
  bands.forEach((_, i) => { top[i] = i === 0 ? 0 : top[i - 1] + bandHeight[i - 1] + BAND_GAP })
  ranked.ranks.forEach((ids, r) => {
    const band = bandOf.get(r) ?? 0 // coverage:invariant — every rank came from bands, which covers all of them
    const left = x[bands[band].ranks[0]]
    const dy = top[band] + (bandHeight[band] - row.heights[r]) / 2
    for (const id of ids) {
      const src = ranked.items.get(id)
      const s = sizes.get(id)
      if (!src || !s) continue
      // a dummy is a point on the corridor, a real node is centred in its column
      let offset = W[r] / 2
      if (!src.dummy) offset = (W[r] - s.w) / 2
      const px = margin + x[r] - left + offset
      // coverage:invariant — stackRows writes a y for every id it sized, and `s` proves it was sized
      items.set(id, { ...src, w: s.w, h: s.h, x: round1(px), y: round1((row.ys.get(id) ?? 0) + dy), band })
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

/**
 * One box per row of columns. A group whose members land in two rows would otherwise enclose everything
 * between them — the gap, the other row's nodes — and the audit rightly calls that a stranger in the frame.
 */
function groupBoxes(level: LevelSpec, boxes: Map<string, Box>, items: Map<string, PlacedItem>): Placed['groups'] {
  return (level.groups ?? []).flatMap((g) => {
    const byBand = new Map<number, Box[]>()
    for (const id of g.members) {
      const b = boxes.get(id)
      if (!b) continue
      const band = items.get(id)?.band ?? 0 // coverage:invariant — a placed member always carries its band
      byBand.set(band, [...(byBand.get(band) ?? []), b])
    }
    return [...byBand.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([band, members], i) => ({ id: i === 0 ? g.id : `${g.id}#${band}`, label: g.label, box: groupBox(members) }))
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
  // the budget is for the whole drawing, margins included
  const bands = bandRows(W, x, cfg.rowWidth > 0 ? cfg.rowWidth - cfg.lane * 6 : 0)
  const row = stackRows(ranked, sizes, cfg)
  // every row keeps a margin on the left so a wire can come down beside its first column
  const margin = cfg.lane * 6
  const items = buildItems(ranked, sizes, row, W, x, bands, margin)

  const boxes = new Map<string, Box>()
  for (const [id, it] of items) if (!it.dummy) boxes.set(id, { x: it.x, y: it.y, w: it.w, h: it.h })
  const groups = groupBoxes(level, boxes, items)
  const last = W.length - 1
  const width = margin + Math.max(0, ...bands.map((b) => b.width))
  const height = items.size ? Math.max(...[...items.values()].map((it) => it.y + it.h)) : 0
  const size = normalise(items, boxes, groups, { w: last >= 0 ? width : 0, h: height })
  // after normalise: it may have shifted everything down, and a band read before the shift would put the gap
  // above the first row's lowest box (measured: a row gap 38px above where the boxes actually ended)
  const spans = bands.map((b) => {
    const members = [...items.values()].filter((it) => b.ranks.includes(it.rank))
    // coverage:invariant — a band with no items cannot exist: bands are built from ranks that have items
    const top = members.length ? Math.min(...members.map((it) => it.y)) : 0
    // coverage:invariant — see above
    const bottom = members.length ? Math.max(...members.map((it) => it.y + it.h)) : 0
    return { top: round1(top), bottom: round1(bottom), ranks: b.ranks }
  })
  return { items, chains: ranked.chains, boxes, groups, bands: spans, size }
}

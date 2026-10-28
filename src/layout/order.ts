/**
 * Ordering — items inside a column are permuted until the wires cross least.
 *
 * Only columns that sit next to each other are related: a chain's consecutive
 * items always land in adjacent columns, so the crossing count is a sum of
 * inversions over those pairs. Six alternating barycenter sweeps (down, up, …)
 * each start from the previous sweep's result, and the best ordering seen — the
 * initial one included — wins, ties to whatever came first.
 *
 * @module c4-view/layout/order
 */
import type { LayoutConfig, Ranked, RankItem } from '../types.ts'

/** Sweeps the spec asks for; more is not better, it just costs time. */
const SWEEPS = 6

interface Pair {
  /** item id in the lower column */
  a: string
  /** item id in the column above it */
  b: string
}

/** Consecutive chain items that sit in adjacent columns, lower end first. */
function adjacentPairs(ranked: Ranked): Pair[] {
  const out: Pair[] = []
  for (const chain of ranked.chains) {
    for (let i = 0; i + 1 < chain.items.length; i++) {
      const a = chain.items[i]
      const b = chain.items[i + 1]
      const ra = ranked.items.get(a)
      const rb = ranked.items.get(b)
      if (!ra || !rb) continue
      if (rb.rank === ra.rank + 1) out.push({ a, b })
      else if (ra.rank === rb.rank + 1) out.push({ a: b, b: a })
    }
  }
  return out
}

/** Neighbours of each item in the next (`down`) and previous (`up`) column. */
function adjacency(ranked: Ranked): { down: Map<string, string[]>; up: Map<string, string[]> } {
  const down = new Map<string, string[]>()
  const up = new Map<string, string[]>()
  const add = (m: Map<string, string[]>, key: string, value: string): void => {
    const list = m.get(key)
    if (list) list.push(value)
    else m.set(key, [value])
  }
  for (const { a, b } of adjacentPairs(ranked)) {
    add(down, a, b)
    add(up, b, a)
  }
  return { down, up }
}

/** Item id → position in its column, for one column of the current ordering. */
function positionsOf(rows: string[][], r: number): Map<string, number> {
  const out = new Map<string, number>()
  const row = rows[r] ?? []
  for (let i = 0; i < row.length; i++) out.set(row[i], i)
  return out
}

/** Mean position of the neighbours, or the item's own index when it has none. */
function barycentre(neighbours: string[] | undefined, pos: Map<string, number>, own: number): number {
  if (!neighbours || !neighbours.length) return own
  let sum = 0
  let n = 0
  for (const id of neighbours) {
    const at = pos.get(id)
    if (at === undefined) continue
    sum += at
    n += 1
  }
  return n ? sum / n : own
}

/** Stable sort by (barycentre, current index); no-neighbour items keep their slot. */
function reorder(row: string[], key: (id: string, own: number) => number): string[] {
  return row
    .map((id, own) => ({ id, own, k: key(id, own) }))
    .sort((x, y) => x.k - y.k || x.own - y.own)
    .map((entry) => entry.id)
}

/** Inversions in one column pair's position list. */
function inversions(pairs: Array<[number, number]>): number {
  let total = 0
  // ponytail: O(n²), swap for a BIT when a level exceeds a few hundred items
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) total += 1
    }
  }
  return total
}

/** Inversions between adjacent columns — the cost `order` minimises. */
export function countCrossings(ranked: Ranked): number {
  const pos = ranked.ranks.map((_, r) => positionsOf(ranked.ranks, r))
  const edges: Array<Array<[number, number]>> = ranked.ranks.map(() => [])
  for (const { a, b } of adjacentPairs(ranked)) {
    const item = ranked.items.get(a)
    if (!item) continue
    const pa = pos[item.rank]?.get(a)
    const pb = pos[item.rank + 1]?.get(b)
    if (pa === undefined || pb === undefined) continue
    edges[item.rank].push([pa, pb])
  }
  return edges.reduce((total, bucket) => total + inversions(bucket), 0)
}

/**
 * One pass. `forward` walks columns left to right and orders each by the mean position of the
 * neighbours behind it (the `up` map); the reverse pass uses the ones ahead (the `down` map).
 */
function sweep(rows: string[][], up: Map<string, string[]>, down: Map<string, string[]>, forward: boolean): void {
  if (forward) {
    for (let r = 1; r < rows.length; r++) {
      const prev = positionsOf(rows, r - 1)
      rows[r] = reorder(rows[r], (id, own) => barycentre(up.get(id), prev, own))
    }
    return
  }
  for (let r = rows.length - 2; r >= 0; r--) {
    const next = positionsOf(rows, r + 1)
    rows[r] = reorder(rows[r], (id, own) => barycentre(down.get(id), next, own))
  }
}

/** Barycenter-ordered copy of `ranked`; the input is never touched. */
export function order(ranked: Ranked, _cfg: LayoutConfig): Ranked {
  const { down, up } = adjacency(ranked)
  let rows = ranked.ranks.map((row) => [...row])
  const score = (candidate: string[][]): number =>
    countCrossings({ ranks: candidate, items: ranked.items, chains: ranked.chains })

  let best = rows.map((row) => [...row])
  let bestScore = score(rows)

  for (let s = 0; s < SWEEPS; s++) {
    sweep(rows, up, down, s % 2 === 0)
    const sc = score(rows)
    if (sc < bestScore) {
      bestScore = sc
      best = rows.map((row) => [...row])
    }
  }

  const items = new Map<string, RankItem>()
  for (const [id, item] of ranked.items) items.set(id, { ...item })
  best.forEach((row, r) =>
    row.forEach((id, i) => {
      const item = items.get(id)
      if (item) items.set(id, { ...item, rank: r, index: i })
    }),
  )
  return { ranks: best, items, chains: ranked.chains }
}

/**
 * Ranking — the input graph becomes columns.
 *
 * Chains are built in input order, cycles are broken by one DFS in input order,
 * and every node gets a column: its own `rank` hint if it has one, otherwise its
 * longest-path depth. A forward chain that spans more than one column gets one
 * dummy per column it crosses, so routing has a corridor to travel.
 *
 * @module c4-view/layout/rank
 */
import { round1 } from './geometry.ts'
import type { Chain, EdgeStyle, LayoutConfig, LevelSpec, Ranked, RankItem } from '../types.ts'

interface Edge {
  key: string
  from: string
  to: string
  label?: string
  style: EdgeStyle
}

interface Dummy { id: string; rank: number; src: number; chain: number }

/** Unique edges in input order: `${from}->${to}`, first occurrence wins. */
function edgesOf(level: LevelSpec): Edge[] {
  const seen = new Set<string>()
  const out: Edge[] = []
  for (const e of level.edges) {
    const key = `${e.from}->${e.to}`
    if (seen.has(key)) continue
    seen.add(key)
    const edge: Edge = { key, from: e.from, to: e.to, style: e.style ?? 'flow' }
    if (e.label !== undefined) edge.label = e.label
    out.push(edge)
  }
  return out
}

/** Depth-first walk from one root, collecting back edges and the post-order. */
function walkFrom(
  root: string,
  edges: Edge[],
  outgoing: Map<string, number[]>,
  colour: Map<string, 0 | 1 | 2>,
  back: Set<number>,
  post: string[],
): void {
  colour.set(root, 1)
  const stack: Array<{ id: string; at: number }> = [{ id: root, at: 0 }]
  while (stack.length) {
    const top = stack[stack.length - 1]
    const adj = outgoing.get(top.id) ?? []
    if (top.at >= adj.length) {
      colour.set(top.id, 2)
      post.push(top.id)
      stack.pop()
      continue
    }
    const ci = adj[top.at]
    top.at += 1
    const to = edges[ci].to
    const seen = colour.get(to) ?? 0
    if (seen === 1) back.add(ci)
    else if (seen === 0) {
      colour.set(to, 1)
      stack.push({ id: to, at: 0 })
    }
  }
}

/** Iterative DFS in input order: an edge pointing at a node on the stack is a back edge. */
function breakCycles(ids: string[], edges: Edge[], outgoing: Map<string, number[]>): { back: Set<number>; topo: string[] } {
  const colour = new Map<string, 0 | 1 | 2>()
  const back = new Set<number>()
  const post: string[] = []
  for (const root of ids) if ((colour.get(root) ?? 0) === 0) walkFrom(root, edges, outgoing, colour, back, post)
  const topo = [...post]
  topo.reverse()
  return { back, topo }
}

/** Longest path over the forward edges, relaxed once in topological order, hints fixed. */
function assignRanks(
  ids: string[],
  topo: string[],
  edges: Edge[],
  outgoing: Map<string, number[]>,
  back: Set<number>,
  hint: Map<string, number>,
): Map<string, number> {
  const rankOf = new Map<string, number>(ids.map((id) => [id, hint.get(id) ?? 0]))
  // every id is seeded above, so a miss here is a bug in this function, not a missing node
  const at = (id: string): number => rankOrThrow(rankOf, id)
  for (const id of topo) {
    const want = at(id) + 1
    for (const ci of outgoing.get(id) ?? []) {
      const to = edges[ci].to
      if (back.has(ci) || hint.has(to)) continue
      if (at(to) < want) rankOf.set(to, want)
    }
  }
  return rankOf
}

/** Read a rank that must exist; a miss is a bug here, not a missing node, so it says so. */
function rankOrThrow(rankOf: Map<string, number>, id: string): number {
  const value = rankOf.get(id)
  if (value === undefined) throw new Error(`rank missing for "${id}" — assignRanks seeds every id`) // coverage:invariant — seeded for every id; a miss is a bug in this file
  return value
}

/**
 * A frame owns its columns. When a box is expanded in place, its interior is wrapped in a group; any node
 * outside that group whose column falls inside the group's span would be drawn *under* the frame. Push it
 * out to the side its edges point: the one that feeds the frame goes left, the one the frame feeds goes right.
 */
function clearGroupSpans(level: LevelSpec, edges: Edge[], rankOf: Map<string, number>, hint: Map<string, number>): void {
  for (const group of level.groups ?? []) {
    const members = group.members.filter((id) => rankOf.has(id))
    if (members.length < 2) continue
    const inside = new Set(members)
    const ranks = members.map((id) => rankOrThrow(rankOf, id))
    const lo = Math.min(...ranks)
    const hi = Math.max(...ranks)
    for (const [id, rank] of rankOf) {
      if (inside.has(id) || hint.has(id) || rank < lo || rank > hi) continue
      const feedsFrame = edges.some((e) => e.from === id && inside.has(e.to))
      // a column of air either side: the frame's own padding would otherwise eat into the neighbour
      // negative ranks are fine: shiftToZero pulls the whole drawing back afterwards
      rankOf.set(id, feedsFrame ? lo - 2 : hi + 2)
    }
  }
}

/** Shift every rank so the drawing starts at column 0. */
function shiftToZero(ids: string[], rankOf: Map<string, number>): void {
  // seeded for every id (see assignRanks), so the reads are total
  const at = (id: string): number => rankOrThrow(rankOf, id)
  let min = Infinity
  for (const id of ids) min = Math.min(min, at(id))
  if (min === 0) return
  for (const id of ids) rankOf.set(id, at(id) - min)
}

/** Chains, with a dummy item per column a forward chain crosses. */
function buildChains(
  edges: Edge[],
  rankOf: Map<string, number>,
  back: Set<number>,
  items: Map<string, RankItem>,
  inputIndex: Map<string, number>,
  lane: number,
): { chains: Chain[]; dummies: Dummy[] } {
  const chains: Chain[] = []
  const dummies: Dummy[] = []
  edges.forEach((e, ci) => {
    const r0 = rankOf.get(e.from) ?? 0
    const r1 = rankOf.get(e.to) ?? 0
    const backward = back.has(ci) || r0 >= r1
    const path: string[] = [e.from]
    for (let r = backward ? r1 : r0 + 1; r < r1; r++) {
      const id = `d:${e.key}:${r}`
      path.push(id)
      items.set(id, { id, rank: r, index: 0, w: 0, h: round1(lane * 1.6), dummy: true })
      dummies.push({ id, rank: r, src: inputIndex.get(e.from) ?? 0, chain: ci })
    }
    path.push(e.to)
    const chain: Chain = { key: e.key, from: e.from, to: e.to, items: path, style: e.style, backward }
    if (e.label !== undefined) chain.label = e.label
    chains.push(chain)
  })
  return { chains, dummies }
}

/** Each column in drawing order: real nodes by input order, then dummies by source. */
function initialOrder(ids: string[], rankOf: Map<string, number>, dummies: Dummy[]): string[][] {
  const last = Math.max(...ids.map((id) => rankOf.get(id) ?? 0), 0)
  const buckets: string[][] = Array.from({ length: last + 1 }, () => [])
  for (const id of ids) buckets[rankOf.get(id) ?? 0].push(id)
  dummies.sort((a, b) => a.src - b.src || a.chain - b.chain)
  for (const d of dummies) buckets[d.rank].push(d.id)
  return buckets
}

/** Ranks a level: chains, columns, dummies, then each column in drawing order. */
export function rank(level: LevelSpec, cfg: LayoutConfig): Ranked {
  const edges = edgesOf(level)
  const ids = level.nodes.map((n) => n.id)
  const items = new Map<string, RankItem>()
  if (!ids.length) return { ranks: [], items, chains: [] }

  const hint = new Map<string, number>()
  const inputIndex = new Map<string, number>()
  level.nodes.forEach((n, i) => {
    inputIndex.set(n.id, i)
    if (n.rank !== undefined) hint.set(n.id, n.rank)
  })

  const outgoing = new Map<string, number[]>()
  edges.forEach((e, ci) => {
    const list = outgoing.get(e.from)
    if (list) list.push(ci)
    else outgoing.set(e.from, [ci])
  })

  const { back, topo } = breakCycles(ids, edges, outgoing)
  const rankOf = assignRanks(ids, topo, edges, outgoing, back, hint)
  clearGroupSpans(level, edges, rankOf, hint)
  shiftToZero(ids, rankOf)
  for (const id of ids) items.set(id, { id, rank: rankOf.get(id) ?? 0, index: 0, w: 0, h: 0, dummy: false })

  if (ids.some((id) => id.includes('/'))) return rankedByScope(edges, items, inputIndex)
  const { chains, dummies } = buildChains(edges, rankOf, back, items, inputIndex, cfg.lane)
  const buckets = initialOrder(ids, rankOf, dummies)
  buckets.forEach((row) => row.forEach((id, i) => {
    const item = items.get(id)
    if (item) items.set(id, { ...item, index: i })
  }))
  return { ranks: buckets, items, chains }
}

/** The scope a composed id lives in: `c4view/cli/args` → `c4view/cli`, a root id → `''`. */
function scopeOf(id: string): string {
  const cut = id.lastIndexOf('/')
  return cut < 0 ? '' : id.slice(0, cut)
}

/**
 * A picture with nested frames ranks each level on its own edges, one column past its host.
 *
 * Flat longest-path over every edge puts a frame's chain in the same columns as the frame's own
 * siblings, so wires cross the whole drawing (measured: 7.96 crossings/edge). Ranking per scope
 * keeps each frame internally ordered the way its own level already is, and puts each frame one
 * column past the box it belongs to — the shape a reader expects from nested boxes.
 */
function rankedByScope(edges: Edge[], items: Map<string, RankItem>, inputIndex: Map<string, number>): Ranked {
  const byScope = new Map<string, string[]>()
  for (const id of items.keys()) {
    const scope = scopeOf(id)
    const list = byScope.get(scope)
    if (list) list.push(id)
    else byScope.set(scope, [id])
  }
  const rankOf = new Map<string, number>()
  // each scope takes its own run of columns: siblings sharing columns would put two frames on top of
  // each other, because a frame's box is the bounding box of its members
  const cursor = new Map<string, number>()
  const ordered = [...byScope.keys()].sort((a, b) => depthOf(a) - depthOf(b))
  for (const scope of ordered) {
    const ids = byScope.get(scope) ?? []
    const local = longestPath(ids, edges)
    const parent = scope === '' ? '' : scopeOf(scope)
    const start = scope === '' ? 0 : (rankOf.get(scope) ?? 0) + 1
    const base = scope === '' ? 0 : Math.max(start, cursor.get(`${parent}|${scope}`) ?? start)
    let span = 0
    for (const id of ids) {
      const r = base + (local.get(id) ?? 0)
      rankOf.set(id, r)
      span = Math.max(span, (local.get(id) ?? 0))
    }
    if (scope !== '') cursor.set(`${parent}|${scope}`, base + span + 1)
  }
  const buckets: string[][] = []
  for (const id of items.keys()) {
    const r = rankOf.get(id) ?? 0
    buckets[r] = [...(buckets[r] ?? []), id]
    const item = items.get(id)
    if (item) items.set(id, { ...item, rank: r })
  }
  const rows: string[][] = []
  // within a column, a frame's members stay together: interleaving them with another frame's nodes
  // makes the frames' boxes overlap and swallows nodes that belong somewhere else
  const key = (id: string): string => `${scopeOf(id)}\u0000${String(inputIndex.get(id) ?? 0).padStart(4, '0')}`
  for (let r = 0; r < buckets.length; r++) rows.push((buckets[r] ?? []).sort((a, b) => (key(a) < key(b) ? -1 : 1)))
  rows.forEach((row) => row.forEach((id, i) => {
    const item = items.get(id)
    if (item) items.set(id, { ...item, index: i })
  }))
  // no dummies in a scoped picture: a span of more than one column routes with a jog instead of a corridor
  const chains: Chain[] = edges.map((e) => {
    const chain: Chain = { key: e.key, from: e.from, to: e.to, items: [e.from, e.to], style: e.style, backward: false }
    if (e.label !== undefined) chain.label = e.label
    return chain
  })
  return { ranks: rows.filter((row) => row.length > 0), items, chains }
}

function depthOf(scope: string): number {
  return scope === '' ? 0 : scope.split('/').length
}

/** Longest path over the edges that live entirely inside one scope. */
function longestPath(ids: string[], edges: Edge[]): Map<string, number> {
  const inside = new Set(ids)
  const own = edges.filter((e) => inside.has(e.from) && inside.has(e.to))
  const rank = new Map(ids.map((id) => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false
    for (const e of own) {
      const want = (rank.get(e.from) ?? 0) + 1
      if ((rank.get(e.to) ?? 0) < want) {
        rank.set(e.to, want)
        moved = true
      }
    }
    if (!moved) break
  }
  return rank
}

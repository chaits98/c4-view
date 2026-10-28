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
import type { Chain, EdgeStyle, LayoutConfig, LevelSpec, Ranked, RankItem } from '../types.ts'

interface Edge {
  key: string
  from: string
  to: string
  label?: string
  style: EdgeStyle
}

const round1 = (v: number): number => Math.round(v * 10) / 10

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

/** Iterative DFS in input order: an edge pointing at a node on the stack is a back edge. */
function breakCycles(
  ids: string[],
  edges: Edge[],
  outgoing: Map<string, number[]>,
): { back: Set<number>; topo: string[] } {
  const colour = new Map<string, 0 | 1 | 2>()
  const back = new Set<number>()
  const post: string[] = []
  for (const root of ids) {
    if ((colour.get(root) ?? 0) !== 0) continue
    colour.set(root, 1)
    const stack: Array<{ id: string; at: number }> = [{ id: root, at: 0 }]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const adj = outgoing.get(top.id) ?? []
      if (top.at < adj.length) {
        const ci = adj[top.at]
        top.at += 1
        const to = edges[ci].to
        const seen = colour.get(to) ?? 0
        if (seen === 1) back.add(ci)
        else if (seen === 0) {
          colour.set(to, 1)
          stack.push({ id: to, at: 0 })
        }
      } else {
        colour.set(top.id, 2)
        post.push(top.id)
        stack.pop()
      }
    }
  }
  return { back, topo: post.reverse() }
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

  // longest path over the forward edges, relaxed once in topological order
  const rankOf = new Map<string, number>()
  for (const id of ids) rankOf.set(id, hint.get(id) ?? 0)
  for (const id of topo) {
    const want = (rankOf.get(id) ?? 0) + 1
    for (const ci of outgoing.get(id) ?? []) {
      if (back.has(ci)) continue
      const to = edges[ci].to
      if (hint.has(to)) continue
      if ((rankOf.get(to) ?? 0) < want) rankOf.set(to, want)
    }
  }

  let min = Infinity
  for (const id of ids) min = Math.min(min, rankOf.get(id) ?? 0)
  if (min !== 0) for (const id of ids) rankOf.set(id, (rankOf.get(id) ?? 0) - min)

  for (const id of ids) items.set(id, { id, rank: rankOf.get(id) ?? 0, index: 0, w: 0, h: 0, dummy: false })

  const chains: Chain[] = []
  const dummies: Array<{ id: string; rank: number; src: number; chain: number }> = []
  edges.forEach((e, ci) => {
    const r0 = rankOf.get(e.from) ?? 0
    const r1 = rankOf.get(e.to) ?? 0
    const backward = back.has(ci) || r0 >= r1
    const path: string[] = [e.from]
    if (!backward) {
      for (let r = r0 + 1; r < r1; r++) {
        const id = `d:${e.key}:${r}`
        path.push(id)
        items.set(id, { id, rank: r, index: 0, w: 0, h: round1(cfg.lane * 1.6), dummy: true })
        dummies.push({ id, rank: r, src: inputIndex.get(e.from) ?? 0, chain: ci })
      }
    }
    path.push(e.to)
    const chain: Chain = { key: e.key, from: e.from, to: e.to, items: path, style: e.style, backward }
    if (e.label !== undefined) chain.label = e.label
    chains.push(chain)
  })

  const last = Math.max(...ids.map((id) => rankOf.get(id) ?? 0))
  const buckets: string[][] = Array.from({ length: last + 1 }, () => [])
  for (const id of ids) buckets[rankOf.get(id) ?? 0].push(id)
  dummies.sort((a, b) => a.src - b.src || a.chain - b.chain)
  for (const d of dummies) buckets[d.rank].push(d.id)

  buckets.forEach((row) =>
    row.forEach((id, i) => {
      const item = items.get(id)
      if (item) items.set(id, { ...item, index: i })
    }),
  )

  return { ranks: buckets, items, chains }
}

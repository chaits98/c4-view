/**
 * The flow order — the linear sequence a narration walks.
 *
 * A diagram is a graph; an explanation is a sentence. This module turns one into
 * the other: the model may declare its own `flow` (the true order, which only the
 * author knows), and otherwise the order is derived deterministically — depth
 * first from the source nodes, edges in input order, so a chain is walked end to
 * end before a sibling branch.
 *
 * @module c4-view/flow
 */
import type { LevelSpec } from './types.ts'

export const edgeKey = (from: string, to: string): string => `${from}->${to}`

/**
 * Edges in the order a viewer should animate them, one at a time.
 * Always covers every edge exactly once; declared keys that no longer exist are
 * dropped, and edges the declaration missed are appended in input order.
 */
export function flowOrder(level: LevelSpec): string[] {
  const all = level.edges.map((e) => edgeKey(e.from, e.to))
  const known = new Set(all)
  const declared = (level.flow ?? []).filter((k, i, arr) => known.has(k) && arr.indexOf(k) === i)
  if (declared.length) {
    const seen = new Set(declared)
    return [...declared, ...all.filter((k) => !seen.has(k))]
  }

  const out: string[] = []
  const seen = new Set<string>()
  const byFrom = new Map<string, string[]>()
  level.edges.forEach((e) => {
    const list = byFrom.get(e.from) ?? []
    list.push(edgeKey(e.from, e.to))
    byFrom.set(e.from, list)
  })
  const hasIncoming = new Set(level.edges.map((e) => e.to))
  const walk = (id: string): void => {
    for (const key of byFrom.get(id) ?? []) {
      if (seen.has(key)) continue
      seen.add(key)
      out.push(key)
      walk(key.slice(key.indexOf('->') + 2))
    }
  }
  // ponytail: recursion depth = path length; a 500-node chain would need an explicit stack
  for (const node of level.nodes) if (!hasIncoming.has(node.id)) walk(node.id)
  for (const key of all) if (!seen.has(key)) out.push(key)
  return out
}

/** 1-based position per edge key — what the emitter writes as `data-flow`. */
export function flowIndex(level: LevelSpec): Map<string, number> {
  return new Map(flowOrder(level).map((key, i) => [key, i + 1]))
}

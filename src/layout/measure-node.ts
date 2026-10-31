/**
 * Node text layout — the one place that decides what a box contains and how
 * wide its text makes it. `place` uses the result to size and stack boxes; the
 * emitter uses the same result to draw the lines, so the two can never disagree.
 *
 * @module c4-view/layout/measure-node
 */
import type { LayoutConfig, Measure, NodeSpec } from '../types.ts'
import { lineHeight } from '../metrics.ts'

export interface NodeText {
  /** full width the box needs for its text (pads included) */
  w: number
  /** height the text needs (pads included, before port pressure) */
  h: number
  identity?: string
  /** wrapped label lines, at most 3; the last one carries `…` when truncated */
  lines: string[]
  tech?: string
}

const MAX_LINES = 3
/** Shapes that narrow away from their centre line: their box needs extra room so text
 *  cannot poke out of the sloped edge. Keyed by subtype (the shape map lives in the emitter). */
const NARROW: ReadonlySet<string> = new Set([
  'saga', 'workflow', 'load-balancer', 'serverless-function', 'middleware', 'event-handler',
  'interface', 'dto', 'abstract-class', 'adapter', 'script', 'person', 'database', 'cache', 'schema',
])
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Truncate one line to `maxWidth`, appending `…` when it does not fit. */
function truncate(text: string, maxWidth: number, size: number, m: Measure): string {
  if (m.width(text, size) <= maxWidth) return text
  let out = ''
  for (const ch of text) {
    if (m.width(`${out}${ch}…`, size) > maxWidth) break
    out += ch
  }
  return `${out.trimEnd()}…`
}

/** Measure one node's text block at `cfg.fontSize`. Pure and deterministic. */
export function measureNode(node: NodeSpec, cfg: LayoutConfig, m: Measure): NodeText {
  const inner = cfg.maxW - 2 * cfg.nodePadX
  const labelSize = cfg.fontSize
  const smallSize = Math.max(9, cfg.fontSize - 2)

  const wrapped = m.wrap(node.label, inner, labelSize)
  const lines = wrapped.slice(0, MAX_LINES)
  if (wrapped.length > MAX_LINES) {
    const last = lines[MAX_LINES - 1]
    lines[MAX_LINES - 1] = truncate(`${last} ${wrapped[MAX_LINES] ?? ''}`.trim(), inner, labelSize, m)
  }

  const identity = node.identity ? truncate(node.identity, inner, smallSize, m) : undefined
  const tech = node.tech ? truncate(node.tech, inner, smallSize, m) : undefined

  const widest = Math.max(
    ...lines.map((l) => m.width(l, labelSize)),
    identity ? m.width(identity, smallSize) : 0,
    tech ? m.width(tech, smallSize) : 0,
  )

  const textH = (identity ? lineHeight(smallSize) : 0) + lines.length * lineHeight(labelSize) + (tech ? lineHeight(smallSize) : 0)
  // ponytail: one flat fit factor for every sloped shape; a per-shape fit is the upgrade if a
  // label ever still pokes out of a diamond
  const fit = NARROW.has(node.subtype) ? 1.16 : 1
  return {
    w: Math.ceil(clamp((widest + 2 * cfg.nodePadX) * fit, cfg.minW, cfg.maxW)),
    h: Math.ceil((textH + 2 * cfg.nodePadY) * fit),
    ...(identity ? { identity } : {}),
    lines,
    ...(tech ? { tech } : {}),
  }
}

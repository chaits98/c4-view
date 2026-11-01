/**
 * Node text layout — the one place that decides what a box contains and how
 * wide its text makes it. `place` uses the result to size and stack boxes; the
 * emitter uses the same result to draw the lines, so the two can never disagree.
 *
 * @module c4-view/layout/measure-node
 */
import type { LayoutConfig, Measure, NodeSpec } from '../types.ts'
import { lineHeight } from '../metrics.ts'
import { shapeOf, shapeTextInset } from '../svg/shapes.ts'

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
  // The silhouette decides where text may live (a head, a cylinder's ellipse, a subroutine's
  // side rules), so the box must be big enough for the text AND that band. The inset depends on
  // the box, so settle it in two passes; both are pure arithmetic, so the result is stable.
  const shape = shapeOf(node.subtype)
  let w = Math.ceil(Math.max(cfg.minW, widest + 2 * cfg.nodePadX))
  let h = Math.ceil(textH + 2 * cfg.nodePadY)
  for (let pass = 0; pass < 2; pass++) {
    const inset = shapeTextInset(shape, { x: 0, y: 0, w, h })
    w = Math.ceil(Math.max(cfg.minW, widest + inset.left + inset.right + 2 * cfg.nodePadX))
    h = Math.ceil(textH + inset.top + inset.bottom + 2 * cfg.nodePadY)
  }
  return {
    w,
    h,
    ...(identity ? { identity } : {}),
    lines,
    ...(tech ? { tech } : {}),
  }
}

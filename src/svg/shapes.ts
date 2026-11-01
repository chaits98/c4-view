/**
 * The 13 node outlines. Every shape is one `<path d>` in absolute coordinates,
 * built from the node's box only, so a box and its outline can never disagree.
 *
 * @module c4-view/svg/shapes
 */
import type { Box, Subtype } from '../types.ts'

export type ShapeId =
  | 'rect' | 'rounded' | 'stadium' | 'subroutine' | 'cylinder' | 'circle'
  | 'diamond' | 'hexagon' | 'parallelogram' | 'trapezoid' | 'trapezoidAlt' | 'actor'

/**
 * Where text may live inside a shape, in px. A sloped or headed outline eats the box's
 * outer band; text laid out from the raw box top lands on an actor's head (measured:
 * 58.9px outside the silhouette on a `person` node).
 */
export function shapeTextInset(shape: ShapeId, box: Box): { top: number; bottom: number; left: number; right: number } {
  switch (shape) {
    case 'actor': {
      // the head owns the top of the box; the body's flat bottom needs half a line of room
      const r = Math.min(box.w * 0.22, box.h * 0.2)
      return { top: 2.35 * r + 3, bottom: 10, left: 6, right: 6 }
    }
    case 'subroutine': {
      const off = Math.min(10, box.w * 0.12)
      return { top: 0, bottom: 0, left: off + 4, right: off + 4 }
    }
    case 'diamond':
      return { top: box.h * 0.2, bottom: box.h * 0.2, left: box.w * 0.2, right: box.w * 0.2 }
    case 'hexagon':
    case 'circle':
      return { top: box.h * 0.14, bottom: box.h * 0.14, left: box.w * 0.12, right: box.w * 0.12 }
    case 'cylinder': {
      // the top ellipse is 2·ry tall; text that starts before it has finished sits on the curve
      const ry = Math.min(box.h / 6, box.w / 4)
      return { top: 2 * ry + 3, bottom: ry + 6, left: 6, right: 6 }
    }
    case 'trapezoid':
    case 'trapezoidAlt':
      return { top: 5, bottom: 5, left: box.w * 0.1, right: box.w * 0.1 }
    default:
      return { top: 0, bottom: 0, left: 0, right: 0 }
  }
}

/** Every subtype, spelled out: a new Subtype becomes a compile error, not a silent rect. */
const SHAPE: Record<Subtype, ShapeId> = {
  'system': 'stadium',
  'person': 'actor',
  'role': 'rounded',
  'external-system': 'rect',
  'boundary': 'rect',

  'web-application': 'rect',
  'microservice': 'rect',
  'database': 'cylinder',
  'cache': 'cylinder',
  'message-queue': 'subroutine',
  'file-storage': 'rect',
  'search-engine': 'circle',
  'load-balancer': 'diamond',
  'cdn': 'circle',
  'serverless-function': 'hexagon',
  'batch-job': 'subroutine',
  'container-registry': 'subroutine',
  'dns': 'circle',
  'api-gateway': 'subroutine',

  'ui-component': 'rect',
  'api-controller': 'rect',
  'service-logic': 'subroutine',
  'repository': 'rect',
  'middleware': 'hexagon',
  'plugin': 'rect',
  'module': 'rect',
  'event-handler': 'hexagon',
  'job': 'subroutine',
  'adapter': 'parallelogram',
  'saga': 'diamond',
  'workflow': 'diamond',
  'library': 'rect',
  'config': 'rect',
  'migration': 'rect',
  'test-suite': 'rect',

  'class': 'rect',
  'interface': 'trapezoid',
  'abstract-class': 'trapezoidAlt',
  'function': 'rect',
  'enum': 'subroutine',
  'type-alias': 'rect',
  'c4-module': 'rect',
  'schema': 'cylinder',
  'dto': 'trapezoid',
  'constant': 'rect',
  'test-file': 'rect',
  'migration-file': 'rect',
  'config-file': 'rect',
  'script': 'parallelogram',
}

export function shapeOf(subtype: Subtype): ShapeId {
  // ?? guards a JSON-fed subtype that slipped past model.parse
  return SHAPE[subtype] ?? 'rect'
}

const n = (v: number): string => String(Math.round(v * 10) / 10)
const poly = (pts: Array<[number, number]>): string => {
  const body = pts.map(([px, py]) => `${n(px)} ${n(py)}`).join('L')
  return `M${body}Z`
}
const arc = (r: number): string => `A${n(r)} ${n(r)} 0 0 1 `

/** One outline, rounded to 1 decimal. `w`/`h` are floored at 1 so a degenerate box stays finite. */
export function shapePath(shape: ShapeId, box: Box): string {
  const x = box.x
  const y = box.y
  const w = Math.max(box.w, 1)
  const h = Math.max(box.h, 1)
  const x2 = x + w
  const y2 = y + h
  const cx = x + w / 2
  const cy = y + h / 2
  const rect = `M${n(x)} ${n(y)}H${n(x2)}V${n(y2)}H${n(x)}Z`

  switch (shape) {
    case 'rounded': {
      const r = Math.min(w, h, 12) * 0.35
      return `M${n(x + r)} ${n(y)}H${n(x2 - r)}${arc(r)}${n(x2)} ${n(y + r)}V${n(y2 - r)}${arc(r)}${n(x2 - r)} ${n(y2)}H${n(x + r)}${arc(r)}${n(x)} ${n(y2 - r)}V${n(y + r)}${arc(r)}${n(x + r)} ${n(y)}Z`
    }
    case 'stadium': {
      const r = h / 2
      return `M${n(x + r)} ${n(y)}H${n(x2 - r)}${arc(r)}${n(x2 - r)} ${n(y2)}H${n(x + r)}${arc(r)}${n(x + r)} ${n(y)}Z`
    }
    case 'subroutine': {
      const off = Math.min(10, w * 0.12)
      return `M${n(x + off)} ${n(y)}V${n(y2)}M${n(x2 - off)} ${n(y)}V${n(y2)}${rect}`
    }
    case 'cylinder': {
      const rx = w / 2
      const ry = Math.min(h / 6, w / 4)
      return `M${n(x)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 0 ${n(x2)} ${n(y + ry)}` +
        `M${n(x)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x2)} ${n(y + ry)}V${n(y2 - ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y2 - ry)}Z`
    }
    case 'circle': {
      const r = Math.min(w, h) / 2
      return `M${n(cx - r)} ${n(cy)}${arc(r)}${n(cx + r)} ${n(cy)}${arc(r)}${n(cx - r)} ${n(cy)}Z`
    }
    case 'diamond':
      return poly([[cx, y], [x2, cy], [cx, y2], [x, cy]])
    case 'hexagon': {
      const c = Math.min(w * 0.2, h / 2)
      return poly([[x + c, y], [x2 - c, y], [x2, cy], [x2 - c, y2], [x + c, y2], [x, cy]])
    }
    case 'parallelogram': {
      const s = Math.min(w * 0.18, h * 0.6)
      return poly([[x + s, y], [x2, y], [x2 - s, y2], [x, y2]])
    }
    case 'trapezoid': {
      const c = Math.min(w * 0.16, h * 0.5)
      return poly([[x + c, y], [x2 - c, y], [x2, y2], [x, y2]])
    }
    case 'trapezoidAlt': {
      const c = Math.min(w * 0.16, h * 0.5)
      return poly([[x, y], [x2, y], [x2 - c, y2], [x + c, y2]])
    }
    case 'actor': {
      const r = Math.min(w * 0.22, h * 0.2)
      const hcy = y + r
      const top = Math.min(y2, hcy + r * 1.35)
      return `M${n(cx - r)} ${n(hcy)}${arc(r)}${n(cx + r)} ${n(hcy)}${arc(r)}${n(cx - r)} ${n(hcy)}Z` +
        `M${n(x)} ${n(y2)}C${n(x)} ${n(y + h * 0.62)} ${n(x + w * 0.2)} ${n(top)} ${n(cx)} ${n(top)}` +
        `C${n(x + w * 0.8)} ${n(top)} ${n(x2)} ${n(y + h * 0.62)} ${n(x2)} ${n(y2)}Z`
    }
    default:
      return rect
  }
}

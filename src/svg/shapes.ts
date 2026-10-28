/**
 * The 13 node outlines. Every shape is one `<path d>` in absolute coordinates,
 * built from the node's box only, so a box and its outline can never disagree.
 *
 * @module c4-view/svg/shapes
 */
import type { Box, Subtype } from '../types.ts'

export type ShapeId =
  | 'rect' | 'rounded' | 'stadium' | 'subroutine' | 'cylinder' | 'circle'
  | 'diamond' | 'hexagon' | 'parallelogram' | 'trapezoid' | 'trapezoidAlt' | 'bars' | 'actor'

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
  'message-queue': 'bars',
  'file-storage': 'rect',
  'search-engine': 'circle',
  'load-balancer': 'diamond',
  'cdn': 'circle',
  'serverless-function': 'hexagon',
  'batch-job': 'bars',
  'container-registry': 'bars',
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
  'job': 'bars',
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
  'enum': 'bars',
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
const poly = (pts: Array<[number, number]>): string =>
  `M${pts.map(([px, py]) => `${n(px)} ${n(py)}`).join('L')}Z`
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
    case 'bars': {
      const bh = h / 5
      return [0, 2, 4]
        .map((k) => `M${n(x)} ${n(y + k * bh)}H${n(x2)}V${n(y + (k + 1) * bh)}H${n(x)}Z`)
        .join('')
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

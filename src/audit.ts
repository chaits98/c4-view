/**
 * The audit — the renderer's own grader.
 *
 * Geometry claims are worth nothing; these five counts are the gate. They are
 * computed from the emitted numbers (not from the layout's intentions), and the
 * skill refuses to deliver a diagram whose report is not `ok`.
 *
 * @module c4-view/audit
 */
import type { AuditReport, Box, LevelSpec, Placed, Point, Route, Routed } from './types.ts'

const area = (b: Box): number => Math.max(0, b.w) * Math.max(0, b.h)
void area

/** Intersection area of two boxes (0 when they only touch). */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const inside = (p: Point, b: Box, inset = 0.5): boolean =>
  p.x > b.x + inset && p.x < b.x + b.w - inset && p.y > b.y + inset && p.y < b.y + b.h - inset

interface Seg { a: Point; b: Point; horizontal: boolean }

function segmentsOf(route: Route): Seg[] {
  const out: Seg[] = []
  for (let i = 0; i < route.pts.length - 1; i += 1) {
    const a = route.pts[i]
    const b = route.pts[i + 1]
    if (Math.abs(a.y - b.y) < 0.01) out.push({ a, b, horizontal: true })
    else if (Math.abs(a.x - b.x) < 0.01) out.push({ a, b, horizontal: false })
    else {
      // an oblique run would break the orthogonal promise: audit it as a defect
      out.push({ a, b, horizontal: false })
      out.push({ a: b, b: a, horizontal: true })
    }
  }
  return out
}

/** True when point p lies strictly inside the node box, inset keeps borders clean. */
function nodesHit(p: Point, boxes: Map<string, Box>, skip: ReadonlySet<string>): string | null {
  for (const [id, box] of boxes) {
    if (skip.has(id)) continue
    if (inside(p, box)) return id
  }
  return null
}

function samplePoints(seg: Seg, step = 2): Point[] {
  const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y)
  const n = Math.max(1, Math.ceil(len / step))
  const pts: Point[] = []
  for (let i = 0; i <= n; i += 1) {
    pts.push({ x: seg.a.x + ((seg.b.x - seg.a.x) * i) / n, y: seg.a.y + ((seg.b.y - seg.a.y) * i) / n })
  }
  return pts
}

const rangeOverlap = (a1: number, a2: number, b1: number, b2: number): number =>
  Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2))

/** Count two routes sharing a collinear segment longer than 2px. */
function sharedSegment(x: Seg, y: Seg): boolean {
  if (x.horizontal !== y.horizontal) return false
  if (x.horizontal) {
    if (Math.abs(x.a.y - y.a.y) > 0.5) return false
    return rangeOverlap(x.a.x, x.b.x, y.a.x, y.b.x) > 2
  }
  if (Math.abs(x.a.x - y.a.x) > 0.5) return false
  return rangeOverlap(x.a.y, x.b.y, y.a.y, y.b.y) > 2
}

/** A proper orthogonal crossing between a horizontal and a vertical segment. */
function crosses(h: Seg, v: Seg): boolean {
  const hx1 = Math.min(h.a.x, h.b.x)
  const hx2 = Math.max(h.a.x, h.b.x)
  const vy1 = Math.min(v.a.y, v.b.y)
  const vy2 = Math.max(v.a.y, v.b.y)
  return v.a.x > hx1 + 0.5 && v.a.x < hx2 - 0.5 && h.a.y > vy1 + 0.5 && h.a.y < vy2 - 0.5
}

export function audit(placed: Placed, routed: Routed, level: LevelSpec): AuditReport {
  const boxes = placed.boxes
  const ids = [...boxes.keys()]
  let nodeNode = 0
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (overlapArea(boxes.get(ids[i]) as Box, boxes.get(ids[j]) as Box) > 0.5) nodeNode += 1
    }
  }

  const own = new Map(routed.routes.map((r) => [r.key, new Set(r.key.split('->'))]))
  let wireNode = 0
  for (const route of routed.routes) {
    const skip = own.get(route.key) as Set<string>
    let hit = false
    for (const seg of segmentsOf(route)) {
      for (const p of samplePoints(seg)) {
        if (nodesHit(p, boxes, skip)) { hit = true; break }
      }
      if (hit) break
    }
    if (hit) wireNode += 1
  }

  let wireWire = 0
  let crossings = 0
  const segs = routed.routes.map((r) => segmentsOf(r))
  for (let i = 0; i < routed.routes.length; i += 1) {
    for (let j = i + 1; j < routed.routes.length; j += 1) {
      let shared = false
      for (const a of segs[i]) {
        for (const b of segs[j]) {
          if (sharedSegment(a, b)) { shared = true; break }
          if (a.horizontal !== b.horizontal && (a.horizontal ? crosses(a, b) : crosses(b, a))) crossings += 1
        }
        if (shared) break
      }
      if (shared) wireWire += 1
    }
  }

  const chips = routed.routes.flatMap((r) => (r.label ? [r.label.box] : []))
  let chipChip = 0
  for (let i = 0; i < chips.length; i += 1) {
    for (let j = i + 1; j < chips.length; j += 1) if (overlapArea(chips[i], chips[j]) > 0.5) chipChip += 1
  }
  let chipNode = 0
  for (const chip of chips) {
    for (const id of ids) if (overlapArea(chip, boxes.get(id) as Box) > 0.5) chipNode += 1
  }

  const aspect = routed.size.h > 0 ? Math.round((routed.size.w / routed.size.h) * 100) / 100 : 0
  const ok = nodeNode === 0 && wireNode === 0 && wireWire === 0 && chipChip === 0 && chipNode === 0
  return {
    level: level.path,
    nodes: level.nodes.length,
    edges: level.edges.length,
    nodeNode,
    wireNode,
    wireWire,
    crossings,
    chipChip,
    chipNode,
    ok,
    aspect,
  }
}

/** One-line human form, used by the CLI and the workbook. */
export function auditLine(r: AuditReport): string {
  const gates = `node∧node=${r.nodeNode} wire∧node=${r.wireNode} wire∧wire=${r.wireWire} chip∧chip=${r.chipChip} chip∧node=${r.chipNode}`
  return `${r.ok ? 'OK  ' : 'FAIL'} level="${r.level || '(root)'}" nodes=${r.nodes} edges=${r.edges} ${gates} crossings=${r.crossings} aspect=${r.aspect}`
}

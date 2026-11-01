/**
 * The audit — the renderer's own grader.
 *
 * Geometry claims are worth nothing; these counts are the gate. They are computed from the
 * emitted numbers (not from the layout's intentions), and the skill refuses to deliver a
 * diagram whose report is not `ok`. Each gate is its own counter so a failure names itself.
 *
 * @module c4-view/audit
 */
import type { AuditReport, Box, LevelSpec, Placed, Point, Route, Routed } from './types.ts'

/** Intersection area of two boxes (0 when they only touch). */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const inside = (p: Point, b: Box, inset = 0.5): boolean =>
  p.x > b.x + inset && p.x < b.x + b.w - inset && p.y > b.y + inset && p.y < b.y + b.h - inset

/** How far from its own port a wire may still be "touching" its end node. */
const PORT_RADIUS = 8
/** …and how much overlap still counts as "touching" rather than "overlapping". */
const MIN_OVERLAP = 0.5

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

function samplePoints(seg: Seg, step = 2): Point[] {
  const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y)
  const n = Math.max(1, Math.ceil(len / step))
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: seg.a.x + ((seg.b.x - seg.a.x) * i) / n,
    y: seg.a.y + ((seg.b.y - seg.a.y) * i) / n,
  }))
}

const rangeOverlap = (a1: number, a2: number, b1: number, b2: number): number =>
  Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2))

/** True when the two segments lie on one line and share more than 2px of it. */
function sharedSegment(x: Seg, y: Seg): boolean {
  if (x.horizontal !== y.horizontal) return false
  const same = x.horizontal ? Math.abs(x.a.y - y.a.y) <= 0.5 : Math.abs(x.a.x - y.a.x) <= 0.5
  if (!same) return false
  const [p1, p2, q1, q2] = x.horizontal
    ? [x.a.x, x.b.x, y.a.x, y.b.x]
    : [x.a.y, x.b.y, y.a.y, y.b.y]
  return rangeOverlap(p1, p2, q1, q2) > 2
}

/** A proper orthogonal crossing between a horizontal and a vertical segment. */
function crosses(h: Seg, v: Seg): boolean {
  const hx1 = Math.min(h.a.x, h.b.x)
  const hx2 = Math.max(h.a.x, h.b.x)
  const vy1 = Math.min(v.a.y, v.b.y)
  const vy2 = Math.max(v.a.y, v.b.y)
  return v.a.x > hx1 + 0.5 && v.a.x < hx2 - 0.5 && h.a.y > vy1 + 0.5 && h.a.y < vy2 - 0.5
}

/** node ∧ node. */
function countNodeNode(boxes: readonly Box[]): number {
  let count = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (overlapArea(boxes[i], boxes[j]) > MIN_OVERLAP) count += 1
    }
  }
  return count
}

/**
 * wire ∧ node. A wire legitimately touches its ends — but only AT the port: exempting a
 * route's whole end nodes (the old rule) hid a wire that ran 107.5px through its own source
 * and audited clean. The exemption is a radius around the two endpoints, nothing else.
 */
function routeHitsNode(route: Route, boxes: readonly Box[]): boolean {
  const ends = [route.pts[0], route.pts[route.pts.length - 1]].filter(Boolean)
  const nearEnd = (p: Point): boolean => ends.some((e) => Math.hypot(e.x - p.x, e.y - p.y) <= PORT_RADIUS)
  for (const seg of segmentsOf(route)) {
    for (const p of samplePoints(seg)) {
      if (nearEnd(p)) continue
      if (boxes.some((box) => inside(p, box))) return true
    }
  }
  return false
}

/** wire ∧ wire (one pair) and the crossings between them. */
function compareRoutes(a: Seg[], b: Seg[]): { shared: boolean; crossings: number } {
  let crossings = 0
  let shared = false
  for (const x of a) {
    for (const y of b) {
      if (sharedSegment(x, y)) shared = true
      else if (x.horizontal !== y.horizontal && (x.horizontal ? crosses(x, y) : crosses(y, x))) crossings += 1
    }
  }
  return { shared, crossings }
}

/** wire ∧ wire and the unavoidable crossings, over every route pair. */
function countWirePairs(routes: readonly Route[]): { wireWire: number; crossings: number } {
  const segs = routes.map(segmentsOf)
  let wireWire = 0
  let crossings = 0
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const pair = compareRoutes(segs[i], segs[j])
      if (pair.shared) wireWire += 1
      crossings += pair.crossings
    }
  }
  return { wireWire, crossings }
}

/** chip ∧ chip and chip ∧ node. */
function countChips(chips: readonly Box[], boxes: readonly Box[]): { chipChip: number; chipNode: number } {
  let chipChip = 0
  let chipNode = 0
  for (let i = 0; i < chips.length; i += 1) {
    for (let j = i + 1; j < chips.length; j += 1) {
      if (overlapArea(chips[i], chips[j]) > MIN_OVERLAP) chipChip += 1
    }
    for (const box of boxes) if (overlapArea(chips[i], box) > MIN_OVERLAP) chipNode += 1
  }
  return { chipChip, chipNode }
}

/** A boundary box that covers a node which is not one of its members. */
function countGroupNode(placed: Placed, level: LevelSpec, boxes: Map<string, Box>): number {
  let count = 0
  for (const spec of level.groups ?? []) {
    const box = placed.groups.find((g) => g.id === spec.id)?.box
    if (!box) continue
    for (const node of level.nodes) {
      const member = spec.members.includes(node.id)
      const b = boxes.get(node.id)
      if (!member && b && overlapArea(box, b) > MIN_OVERLAP) count += 1
    }
  }
  return count
}

/**
 * Readability budget: past two wire crossings per edge the drawing stops being traceable by eye. Not taste —
 * a number an agent can check before it argues that its picture is fine.
 */
export const isDense = (crossings: number, edges: number): boolean => crossings > Math.max(2, edges * 2)

/** Which picture this line judges: the root, or a level as it is SERVED (composed). */
function whereLabel(r: AuditReport): string {
  if (!r.level) return 'level="(root)"'
  return r.composed ? `level="${r.level}" (composed)` : `level="${r.level}"`
}

export function audit(placed: Placed, routed: Routed, level: LevelSpec): AuditReport {
  const boxes = [...placed.boxes.values()]
  const byId = placed.boxes
  const nodeNode = countNodeNode(boxes)
  const wireNode = routed.routes.filter((route) => routeHitsNode(route, boxes)).length
  const { wireWire, crossings } = countWirePairs(routed.routes)
  const chips = routed.routes.flatMap((r) => (r.label ? [r.label.box] : []))
  const { chipChip, chipNode } = countChips(chips, boxes)
  const groupNode = countGroupNode(placed, level, byId)
  const aspect = routed.size.h > 0 ? Math.round((routed.size.w / routed.size.h) * 100) / 100 : 0
  // a backward edge is legal (a real loop), but an UNINTENDED one means a rank hint fights an edge,
  // and the router will answer with a corridor under the whole drawing — so it is always reported
  const backward = placed.chains.filter((chain) => chain.backward).length
  const dense = isDense(crossings, level.edges.length)
  const ok = nodeNode === 0 && wireNode === 0 && wireWire === 0 && chipChip === 0 && chipNode === 0 && groupNode === 0 && !dense
  return {
    level: level.path,
    backward,
    nodes: level.nodes.length,
    edges: level.edges.length,
    nodeNode,
    wireNode,
    wireWire,
    crossings,
    chipChip,
    chipNode,
    groupNode,
    ok,
    dense,
    aspect,
  }
}

/** One-line human form, used by the CLI and the workbook. */
export function auditLine(r: AuditReport): string {
  const gates = `node∧node=${r.nodeNode} wire∧node=${r.wireNode} wire∧wire=${r.wireWire} chip∧chip=${r.chipChip} chip∧node=${r.chipNode} group∧node=${r.groupNode}`
  // a level with a parent is only ever served composed; saying so stops a green line being read as the
  // authored level passing
  const where = whereLabel(r)
  return `${r.ok ? 'OK  ' : 'FAIL'} ${where} nodes=${r.nodes} edges=${r.edges} ${gates} crossings=${r.crossings} backward=${r.backward} aspect=${r.aspect}`
}

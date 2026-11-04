/**
 * The SVG emitter. One self-contained `<svg>` element: no `<style>`, no
 * external refs, every colour an attribute, every string escaped.
 *
 * Layer order (back to front): groups → routes → nodes → chips.
 * Node/route `data-*` attributes are the viewer's only contract.
 *
 * @module c4-view/svg/emit
 */
import { SUBTYPE_KIND, type Box, type EdgeStyle, type LayoutConfig, type LevelSpec, type NodeSpec, type Placed, type Route, type Routed } from '../types.ts'
import type { Theme } from '../theme.ts'
import { FONT_FAMILY, lineHeight, measure } from '../metrics.ts'
import { measureNode } from '../layout/measure-node.ts'
import { shapeOf, shapePath, shapeTextInset } from './shapes.ts'

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** labels/tech/identity/id/desc/drill are agent-written: escape every one of them. */
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c])
const n = (v: number): string => String(Math.round((Number.isFinite(v) ? v : 0) * 10) / 10)
const STYLES: readonly EdgeStyle[] = ['flow', 'dep', 'tent', 'dir']

function text(x: number, y: number, size: number, fill: string, body: string): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="${FONT_FAMILY}" font-size="${n(size)}" ` +
    `text-anchor="middle" dominant-baseline="central" fill="${fill}">${esc(body)}</text>`
}

function defs(theme: Theme): string {
  const markers = STYLES.map((style) => {
    const stroke = theme.edges[style].stroke
    return `<marker id="arrow-${style}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M0 0L10 5L0 10Z" fill="${stroke}"/></marker>`
  })
  return `<defs>${markers.join('')}</defs>`
}

function groupLayer(placed: Placed, theme: Theme): string[] {
  return placed.groups.map((g) => {
    const b = g.box
    return `<g data-group="${esc(g.id)}">` +
      `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="6" ` +
      `fill="${theme.groupFill}" stroke="${theme.groupStroke}" stroke-dasharray="6 4"/></g>`
  })
}

/**
 * Group names last, on a plate: an edge label crossing the frame would otherwise sit on top of the name of
 * the box the reader just opened — the one word on the page that must never be hidden.
 */
function groupLabelLayer(placed: Placed, theme: Theme): string[] {
  return placed.groups.map((g) => {
    const b = g.box
    const w = Math.max(48, g.label.length * 6.4 + 16)
    return `<g data-group-label="${esc(g.id)}">` +
      `<rect x="${n(b.x + 8)}" y="${n(b.y + 2)}" width="${n(w)}" height="18" rx="4" ` +
      `fill="${theme.chipBg}" stroke="${theme.groupStroke}" stroke-dasharray="6 4"/>` +
      `<text x="${n(b.x + 16)}" y="${n(b.y + 11)}" font-family="${FONT_FAMILY}" font-size="11" ` +
      `text-anchor="start" dominant-baseline="central" fill="${theme.fg}">${esc(g.label)}</text></g>`
  })
}

function pathD(r: Route): string {
  return r.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join('')
}

function routeLayer(routed: Routed, placed: Placed, theme: Theme, flow: Map<string, number>, descOf: Map<string, string>): string[] {
  const styleOf = new Map(placed.chains.map((c) => [c.key, c.style]))
  return routed.routes.map((r) => {
    const style = styleOf.get(r.key) ?? 'flow'
    // coverage:invariant — EdgeStyle is a closed union of four, and every palette draws all four
    const e = theme.edges[style] ?? theme.edges.flow
    const dash = e.dash ? ` stroke-dasharray="${e.dash}"` : ''
    // data-flow is 1-based position in the linear narration order: the viewer animates
    // exactly one edge at a time, in this order.
    const step = flow.get(r.key)
    const flowAttr = step === undefined ? '' : ` data-flow="${step}"`
    // data-desc is the edge's own sentence: the hover card and the flow caption read it
    const desc = descOf.get(r.key)
    const descAttr = desc ? ` data-desc="${esc(desc)}"` : ''
    return `<path data-key="${esc(r.key)}"${descAttr}${flowAttr} d="${pathD(r)}" stroke="${e.stroke}" stroke-width="${n(e.width)}"${dash} ` +
      `fill="none" marker-end="url(#arrow-${style})"/>`
  })
}

function nodeLayer(level: LevelSpec, placed: Placed, cfg: LayoutConfig, theme: Theme, drill: Map<string, string>, linkBase?: string, hosts?: Set<string>): string[] {
  const small = Math.max(9, cfg.fontSize - 2)
  const lh = lineHeight(cfg.fontSize)
  const slh = lineHeight(small)
  return level.nodes.flatMap((node: NodeSpec) => {
    const box = placed.boxes.get(node.id)
    if (!box) return [] // coverage:invariant — every node of the level is measured and placed
    const t = measureNode(node, cfg, measure)
    const shape = node.shape === 'rect' ? 'rect' : shapeOf(node.subtype)
    /* node:coverage disable */
    // model.parse refuses an unknown subtype, so the fallback only covers a hand-built LevelSpec
    const kind = SUBTYPE_KIND[node.subtype] ?? 'concept'
    /* node:coverage enable */
    const k = theme.kinds[kind]
    const attrs = [`data-id="${esc(node.id)}"`, `data-kind="${kind}"`]
    if (node.desc) attrs.push(`data-desc="${esc(node.desc)}"`)
    const child = drill.get(node.id)
    if (child) attrs.push(`data-drill="${esc(child)}"`)
    // A drill is navigation, so it is a real link when the caller can name one: middle-click, Back,
    // copy-link and screen readers all work, and the page needs no JS to follow it.
    const href = child && linkBase ? `${linkBase}/${child}` : ''
    const open = href ? `<a class="c4-link" href="${esc(href)}">` : ''
    const close = open ? '</a>' : ''
    const parts = [open + `<g class="node" ${attrs.join(' ')}>`]
    parts.push(`<path d="${shapePath(shape, box)}" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.4"/>`)
    // text lives in the shape's own text band and is centred in it — an actor's head is
    // part of the box, not something to write over
    const inset = shapeTextInset(shape, box)
    const textH = (t.identity ? slh : 0) + t.lines.length * lh + (t.tech ? slh : 0)
    const bandTop = box.y + inset.top
    const bandH = box.h - inset.top - inset.bottom
    // a host's label sits at the head of its box: centring it in a box sized to a whole drawing wrote the
    // name straight through the picture inside it
    let cursor = hosts?.has(node.id) ? bandTop + HOST_LABEL_PAD : bandTop + Math.max(0, (bandH - textH) / 2)
    const cx = box.x + box.w / 2
    if (t.identity) {
      parts.push(text(cx, cursor + slh / 2, small, theme.dim, t.identity))
      cursor += slh
    }
    t.lines.forEach((line, i) => parts.push(text(cx, cursor + lh / 2 + i * lh, cfg.fontSize, theme.fg, line)))
    cursor += t.lines.length * lh
    if (t.tech) parts.push(text(cx, cursor + slh / 2, small, theme.dim, t.tech))
    parts.push(`</g>${close}`)
    return parts
  })
}

function chipLayer(routed: Routed, cfg: LayoutConfig, theme: Theme): string[] {
  return routed.routes.flatMap((r) => {
    const label = r.label
    if (!label) return []
    const b: Box = label.box
    return [`<g data-chip="1" data-key="${esc(r.key)}">` +
      `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="4" ` +
      `fill="${theme.chipBg}" stroke="${theme.line}"/>` +
      `${text(b.x + b.w / 2, b.y + b.h / 2, Math.max(9, cfg.fontSize - 1), theme.chipFg, label.text)}</g>`]
  })
}

/** What the emitter needs beyond the geometry: where drills go, which edges animate, and how to link them. */
export interface EmitOptions {
  drill?: Map<string, string>
  flow?: Map<string, number>
  linkBase?: string
  /** paint the canvas behind the drawing: an exported file has no page CSS to do it */
  background?: string
  /** boxes that hold a picture: their label goes to the top, the picture sits under it */
  hosts?: Set<string>
}

/** Space between a host box's top edge and its label, and the height that label block claims. */
export const HOST_LABEL_PAD = 8

export function emit(
  placed: Placed, routed: Routed, level: LevelSpec,
  cfg: LayoutConfig, theme: Theme, options: EmitOptions = {},
): string {
  const drill = options.drill ?? new Map<string, string>()
  const flow = options.flow ?? new Map<string, number>()
  const descOf = new Map(level.edges.flatMap((e) => (e.desc ? [[`${e.from}->${e.to}`, e.desc] as [string, string]] : [])))
  const linkBase = options.linkBase
  // drawn size never below the boxes it must contain, even if a route stage underpays
  const w = Math.max(placed.size.w, routed.size.w) + 16
  const h = Math.max(placed.size.h, routed.size.h) + 16
  const body = [
    ...groupLayer(placed, theme),
    ...routeLayer(routed, placed, theme, flow, descOf),
    ...nodeLayer(level, placed, cfg, theme, drill, linkBase, options.hosts),
    ...chipLayer(routed, cfg, theme),
    ...groupLabelLayer(placed, theme),
  ]
  const canvas = options.background
    ? `<rect class="c4-canvas" x="0" y="0" width="${n(w)}" height="${n(h)}" fill="${options.background}"/>`
    : ''
  // the accessible name is an aria-label, not a <title> child: a <title> is also the browser's own tooltip,
  // and it floated a second, identical-to-nothing bubble beside the hover card the viewer draws
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" role="img"` +
    ` aria-label="${esc(level.title ?? (level.path || 'C4 diagram'))}">` +
    `${defs(theme)}${canvas}` +
    `<g class="c4-root" transform="translate(8,8)">${body.join('')}</g></svg>`
}

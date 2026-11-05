/**
 * One node: raw JSON → renderer shape. This is the whitelist that decides which model fields survive
 * (a field it drops is a field the renderer cannot honour), split out of `model.ts` when that file
 * crossed the repo's 300-line ceiling.
 *
 * @module c4-view/model-node
 */
import type { NodeSpec, Subtype } from './types.ts'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'  // '' is a legal tech/desc: absent and empty differ

const MAX_LINKS = 5
const TEXT_FIELDS = ['tech', 'desc', 'identity', 'group'] as const

function sizeOf(raw: unknown): { w?: number; h?: number } | null {
  if (!isObj(raw)) return null
  const w = typeof raw.w === 'number' && raw.w > 0 ? raw.w : undefined
  const h = typeof raw.h === 'number' && raw.h > 0 ? raw.h : undefined
  if (w === undefined && h === undefined) return null
  return { ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) }
}

function linksOf(raw: unknown): { label: string; href: string }[] | null {
  if (!Array.isArray(raw)) return null
  const out: { label: string; href: string }[] = []
  for (const l of raw.slice(0, MAX_LINKS)) {
    /* coverage:invariant — parseModel refuses a malformed entry, so this guard serves a model built in
       code without validation, which no fixture can produce */
    if (!isObj(l) || !str(l.href) || !/^https?:\/\//i.test(l.href)) continue
    out.push({ label: str(l.label) ? l.label.slice(0, 60) : l.href.slice(0, 60), href: l.href.slice(0, 400) })
  }
  return out.length ? out : null
}

function nodeOf(raw: unknown): NodeSpec | null {
  if (!isObj(raw) || !str(raw.id) || !str(raw.label) || !str(raw.subtype)) return null
  const node: NodeSpec = { id: raw.id, label: raw.label, subtype: raw.subtype as Subtype }
  if (str(raw.tech)) node.tech = raw.tech
  if (str(raw.desc)) node.desc = raw.desc
  if (str(raw.identity)) node.identity = raw.identity
  if (str(raw.group)) node.group = raw.group
  if (typeof raw.rank === 'number') node.rank = raw.rank
  // `size` is the author's floor on a box. It has to be copied here or it never reaches the layout:
  // this function is the whitelist, and a field it drops is a field the renderer cannot honour.
  const size = sizeOf(raw.size)
  if (size) node.size = size
  const links = linksOf(raw.links)
  if (links) node.links = links
  if (isState(raw.state)) node.state = raw.state
  return node
}

const STATES = ['built', 'planned', 'partial', 'retired'] as const

function isState(v: unknown): v is (typeof STATES)[number] {
  return typeof v === 'string' && (STATES as readonly string[]).includes(v)
}

function checkNodeText(raw: Record<string, unknown>, at: string, bad: string[]): void {
  for (const key of TEXT_FIELDS) {
    if (raw[key] !== undefined && !str(raw[key])) bad.push(`${at}.${key}: must be a string when present`)
  }
  const rank = raw.rank
  if (rank !== undefined && (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0)) {
    bad.push(`${at}.rank: must be a non-negative integer when present`)
  }
  checkLinks(raw.links, at, bad)
  checkSize(raw.size, at, bad)
  if (raw.state !== undefined && !isState(raw.state)) {
    bad.push(`${at}.state: one of ${STATES.join(' | ')} — got ${String(raw.state).slice(0, 20)}`)
  }
}

/** `size` is a floor, so a non-number silently becomes "no floor" — which is exactly the sort of
 *  request that looks honoured and is not. Refuse it by name instead. */
function checkSize(raw: unknown, at: string, bad: string[]): void {
  if (raw === undefined) return
  if (!isObj(raw)) {
    bad.push(`${at}.size: must be an object {w?, h?}`)
    return
  }
  for (const axis of ['w', 'h'] as const) {
    const v = raw[axis]
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
      bad.push(`${at}.size.${axis}: must be a positive number`)
    }
  }
}

/** A link is a promise about where the reader lands. A non-http scheme is refused loudly rather than
 *  dropped: silently ignoring it leaves a node that looks documented and is not. */
function checkLinks(raw: unknown, at: string, bad: string[]): void {
  if (raw === undefined) return
  if (!Array.isArray(raw)) {
    bad.push(`${at}.links: must be an array of {label, href}`)
    return
  }
  if (raw.length > MAX_LINKS) bad.push(`${at}.links: at most ${MAX_LINKS}`)
  raw.forEach((l, i) => {
    const href = isObj(l) ? l.href : undefined
    if (!str(href)) {
      bad.push(`${at}.links[${i}].href: must be a string`)
      return
    }
    if (!/^https?:\/\//i.test(href)) bad.push(`${at}.links[${i}].href: only http(s) — got ${href.slice(0, 40)}`)
  })
}

export { sizeOf, linksOf, nodeOf, checkNodeText }

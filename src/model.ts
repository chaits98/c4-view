/**
 * Model parsing and validation — the trust boundary.
 *
 * An agent writes this JSON, so every error names the exact place it came from
 * (`levels[2].edges[7].to`). A model that parses is already normalised: edges
 * carry a style, duplicate edges are dropped, and no edge references a node
 * that does not exist.
 *
 * @module c4-view/model
 */
import {
  DEFAULT_LAYOUT, SUBTYPE_KIND,
  type EdgeSpec, type EdgeStyle, type GroupSpec, type LayoutConfig, type LevelSpec, type Model,
  type NodeSpec, type Subtype,
} from './types.ts'

export class ModelError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`invalid model:\n  - ${problems.join('\n  - ')}`)
    this.name = 'ModelError'
    this.problems = problems
  }
}

const EDGE_STYLES: readonly EdgeStyle[] = ['flow', 'dep', 'tent', 'dir']
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ID_RULE = '[A-Za-z0-9][A-Za-z0-9_-]*'
const TEXT_FIELDS = ['tech', 'desc', 'identity', 'group'] as const

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'

/** The model's own header: id, title, and that there is at least one level. */
function checkHeader(raw: Record<string, unknown>, bad: string[]): void {
  if (!str(raw.id) || !ID.test(raw.id)) bad.push(`id: required, ${ID_RULE} (max 64)`)
  if (!str(raw.title) || !raw.title.trim()) bad.push('title: required')
  if (!Array.isArray(raw.levels) || raw.levels.length === 0) bad.push('levels: at least one level is required')
}

/** One node in renderer shape (invalid nodes were already reported). */
function nodeOf(raw: unknown): NodeSpec | null {
  if (!isObj(raw) || !str(raw.id) || !str(raw.label) || !str(raw.subtype)) return null
  const node: NodeSpec = { id: raw.id, label: raw.label, subtype: raw.subtype as Subtype }
  if (str(raw.tech)) node.tech = raw.tech
  if (str(raw.desc)) node.desc = raw.desc
  if (str(raw.identity)) node.identity = raw.identity
  if (str(raw.group)) node.group = raw.group
  if (typeof raw.rank === 'number') node.rank = raw.rank
  return node
}

function checkNodeText(raw: Record<string, unknown>, at: string, bad: string[]): void {
  for (const key of TEXT_FIELDS) {
    if (raw[key] !== undefined && !str(raw[key])) bad.push(`${at}.${key}: must be a string when present`)
  }
  const rank = raw.rank
  if (rank !== undefined && (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0)) {
    bad.push(`${at}.rank: must be a non-negative integer when present`)
  }
}

function checkNode(raw: Record<string, unknown>, at: string, ids: Set<string>, bad: string[]): void {
  if (!str(raw.id) || !ID.test(raw.id)) bad.push(`${at}.id: required, ${ID_RULE} (max 64)`)
  else if (ids.has(raw.id)) bad.push(`${at}.id: duplicate node "${raw.id}"`)
  else ids.add(raw.id)
  if (!str(raw.label) || !raw.label.trim()) bad.push(`${at}.label: required`)
  if (!str(raw.subtype) || !(raw.subtype in SUBTYPE_KIND)) {
    bad.push(`${at}.subtype: not a C4 subtype (${str(raw.subtype) ? raw.subtype : 'missing'})`)
  }
  checkNodeText(raw, at, bad)
}

/** Nodes of one level, plus the id set the edges and groups are checked against. */
function parseNodes(raw: unknown, at: string, bad: string[]): { nodes: NodeSpec[]; ids: Set<string> } {
  // a field that must be a list and is not is a mistake, not an absence: silently treating
  // `"nodes": "a"` as no nodes would drop a whole level's contents without saying so
  if (!Array.isArray(raw)) {
    bad.push(`${at}.nodes: must be an array of nodes`)
    return { nodes: [], ids: new Set<string>() }
  }
  const list: unknown[] = raw
  if (!list.length) bad.push(`${at}.nodes: at least one node is required`)
  const ids = new Set<string>()
  list.forEach((node, i) => {
    if (!isObj(node)) bad.push(`${at}.nodes[${i}]: must be an object`)
    else checkNode(node, `${at}.nodes[${i}]`, ids, bad)
  })
  return { nodes: list.flatMap((node) => { const parsed = nodeOf(node); return parsed ? [parsed] : [] }), ids }
}

function checkEdge(raw: Record<string, unknown>, at: string, ids: Set<string>, bad: string[]): void {
  if (!str(raw.from) || !ids.has(raw.from)) bad.push(`${at}.from: unknown node "${String(raw.from)}"`)
  if (!str(raw.to) || !ids.has(raw.to)) bad.push(`${at}.to: unknown node "${String(raw.to)}"`)
  if (raw.from === raw.to) bad.push(`${at}: self-loop on "${String(raw.from)}" — draw it as a node property, not an edge`)
  if (raw.label !== undefined && !str(raw.label)) bad.push(`${at}.label: must be a string when present`)
  // desc is optional so a model written before it existed still draws: the viewer says on the page that the
  // edge can carry one, and the caption has a line waiting for it
  if (raw.desc !== undefined && !str(raw.desc)) bad.push(`${at}.desc: must be a string when present`)
  const style = raw.style
  if (style !== undefined && (!str(style) || !EDGE_STYLES.includes(style as EdgeStyle))) {
    bad.push(`${at}.style: one of ${EDGE_STYLES.join('|')}`)
  }
}

/** Edges of one level, de-duplicated, plus the key set the flow order is checked against. */
function parseEdges(raw: unknown, at: string, ids: Set<string>, bad: string[]): { edges: EdgeSpec[]; keys: Set<string> } {
  const edges: EdgeSpec[] = []
  const keys = new Set<string>()
  if (!Array.isArray(raw)) {
    bad.push(`${at}.edges: must be an array of edges`)
    return { edges, keys }
  }
  const list: unknown[] = raw
  list.forEach((edge, i) => {
    if (!isObj(edge)) { bad.push(`${at}.edges[${i}]: must be an object`); return }
    checkEdge(edge, `${at}.edges[${i}]`, ids, bad)
    const key = `${String(edge.from)}->${String(edge.to)}`
    if (keys.has(key)) return // duplicate edge: drop, do not fail
    keys.add(key)
    edges.push({
      from: String(edge.from),
      to: String(edge.to),
      desc: typeof edge.desc === 'string' ? edge.desc.trim() : '',
      style: (edge.style as EdgeStyle | undefined) ?? 'flow',
      ...(edge.label !== undefined ? { label: String(edge.label) } : {}),
    })
  })
  return { edges, keys }
}

function checkGroup(raw: Record<string, unknown>, at: string, seen: Set<string>, bad: string[]): void {
  if (!str(raw.id) || !ID.test(raw.id)) bad.push(`${at}.id: required, ${ID_RULE}`)
  else if (seen.has(raw.id)) bad.push(`${at}.id: duplicate group "${raw.id}"`)
  else seen.add(raw.id)
  if (!str(raw.label) || !raw.label.trim()) bad.push(`${at}.label: required`)
}

function parseGroups(raw: unknown, at: string, ids: Set<string>, bad: string[]): GroupSpec[] {
  const groups: GroupSpec[] = []
  const seen = new Set<string>()
  if (raw !== undefined && !Array.isArray(raw)) {
    bad.push(`${at}.groups: must be an array of groups`)
    return groups
  }
  const list: unknown[] = Array.isArray(raw) ? raw : []
  list.forEach((group, i) => {
    const gAt = `${at}.groups[${i}]`
    if (!isObj(group)) { bad.push(`${gAt}: must be an object`); return }
    checkGroup(group, gAt, seen, bad)
    const members = Array.isArray(group.members) ? group.members.filter((m): m is string => str(m)) : []
    if (!members.length) bad.push(`${gAt}.members: at least one node id`)
    for (const m of members) if (!ids.has(m)) bad.push(`${gAt}.members: unknown node "${m}"`)
    groups.push({ id: String(group.id), label: String(group.label), members })
  })
  return groups
}

/** The declared narration order: every entry must be an edge of this level. */
function parseFlow(raw: unknown, at: string, keys: Set<string>, bad: string[]): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) { bad.push(`${at}.flow: must be an array of "from->to" edge keys`); return [] }
  const flow: string[] = []
  raw.forEach((key, i) => {
    if (!str(key) || !keys.has(key)) bad.push(`${at}.flow[${i}]: "${String(key)}" is not an edge of this level`)
    else if (!flow.includes(key)) flow.push(key)
  })
  return flow
}


/**
 * `ports` — the lens mapping. Shape only: the keys are parent edge keys and the values are node ids
 * of this level. Whether those edges exist and touch the host is `lensReport`'s job, because that
 * check needs the parent level and belongs in the audit's output.
 */
function parsePorts(raw: unknown, at: string, levelPath: string, ids: Set<string>, bad: string[]): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  if (!isObj(raw)) { bad.push(`${at}.ports: must be an object of "<from->to>": "<node id>"`); return undefined }
  if (!levelPath) bad.push(`${at}.ports: the root level has no parent, so it cannot declare ports`)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[^>\s]+->[^>\s]+$/.test(key)) { bad.push(`${at}.ports["${key}"]: key must look like "from->to"`); continue }
    if (!str(value) || !value.trim()) { bad.push(`${at}.ports["${key}"]: target must be a node id`); continue }
    if (!ids.has(value)) { bad.push(`${at}.ports["${key}"]: unknown node "${value}" in this level`); continue }
    out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

/** One level: its path, its nodes/edges/groups, and its declared flow order. */
function parseLevel(entry: unknown, li: number, seen: Set<string>, bad: string[]): LevelSpec | null {
  const at = `levels[${li}]`
  if (!isObj(entry)) { bad.push(`${at}: must be an object`); return null }
  let path: string | null = null
  if (str(entry.path)) path = entry.path
  else if (li === 0) path = ''
  if (path === null) { bad.push(`${at}.path: required ('' for the root level)`); return null }
  if (seen.has(path)) { bad.push(`${at}.path: duplicate level "${path}"`); return null }
  seen.add(path)

  const { nodes, ids } = parseNodes(entry.nodes, at, bad)
  const { edges, keys } = parseEdges(entry.edges, at, ids, bad)
  const groups = parseGroups(entry.groups, at, ids, bad)
  const flow = parseFlow(entry.flow, at, keys, bad)
  const ports = parsePorts(entry.ports, at, path, ids, bad)
  const title = str(entry.title) && entry.title.trim() ? entry.title : path || 'Overview'
  return { path, title, nodes, edges, groups, ...(flow.length ? { flow } : {}), ...(ports ? { ports } : {}) }
}

/** Parse unknown JSON into a validated, normalised Model. Throws ModelError. */
export function parseModel(raw: unknown): Model {
  if (!isObj(raw)) throw new ModelError(['the model must be a JSON object'])
  const bad: string[] = []
  checkHeader(raw, bad)
  const levels: LevelSpec[] = []
  const seen = new Set<string>()
  const rawLevels: unknown[] = Array.isArray(raw.levels) ? raw.levels : []
  rawLevels.forEach((entry, li) => {
    const level = parseLevel(entry, li, seen, bad)
    if (level) levels.push(level)
  })
  const layout = parseLayout(raw.layout, bad)
  if (bad.length) throw new ModelError(bad)
  return { id: raw.id as string, title: raw.title as string, layout, levels }
}

function parseLayout(raw: unknown, bad: string[]): Partial<LayoutConfig> {
  if (raw === undefined) return {}
  if (!isObj(raw)) { bad.push('layout: must be an object when present'); return {} }
  const out: Partial<LayoutConfig> = {}
  for (const [key, value] of Object.entries(raw)) {
    const fallback = DEFAULT_LAYOUT[key as keyof LayoutConfig]
    if (fallback === undefined) { bad.push(`layout.${key}: unknown setting`); continue }
    if (key === 'direction') {
      if (value !== 'LR' && value !== 'TB' && value !== 'auto') bad.push('layout.direction: "LR", "TB" or "auto"')
      else out.direction = value
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      bad.push(`layout.${key}: must be a positive number`)
      continue
    }
    ;(out as Record<string, number>)[key] = value
  }
  return out
}

/** Config = defaults overlaid with the model's own overrides. */
export function layoutOf(model: Model): LayoutConfig {
  return { ...DEFAULT_LAYOUT, ...(model.layout ?? {}) }
}

export function levelOf(model: Model, path: string): LevelSpec | undefined {
  return model.levels.find((l) => l.path === path)
}

/** Drill path of a node's child level: root '', then 'a', then 'a/b'. */
export function childPath(path: string, nodeId: string): string {
  return path ? `${path}/${nodeId}` : nodeId
}

/** level path → child level, for the emitter's `data-drill` attribute. */
export function drillTargets(model: Model, level: LevelSpec): Map<string, string> {
  const out = new Map<string, string>()
  for (const node of level.nodes) {
    const expected = childPath(level.path, node.id)
    if (model.levels.some((l) => l.path === expected)) out.set(node.id, expected)
  }
  return out
}

/** Every level path, root first, then by depth (parent before child). */
export function levelOrder(model: Model): LevelSpec[] {
  const depth = (path: string): number => path.split('/').filter(Boolean).length
  return [...model.levels].sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
}

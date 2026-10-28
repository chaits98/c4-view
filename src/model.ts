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
import { DEFAULT_LAYOUT, SUBTYPE_KIND, type EdgeStyle, type LevelSpec, type Model, type LayoutConfig, type Subtype } from './types.ts'

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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'

/** Parse unknown JSON into a validated, normalised Model. Throws ModelError. */
export function parseModel(raw: unknown): Model {
  const bad: string[] = []
  if (!isObj(raw)) throw new ModelError(['the model must be a JSON object'])
  if (!str(raw.id) || !ID.test(raw.id)) bad.push('id: required, [A-Za-z0-9][A-Za-z0-9_-]* (max 64)')
  if (!str(raw.title) || !raw.title.trim()) bad.push('title: required')
  if (!Array.isArray(raw.levels) || raw.levels.length === 0) bad.push('levels: at least one level is required')

  const levels: LevelSpec[] = []
  const seenPaths = new Set<string>()
  for (const [li, entry] of (Array.isArray(raw.levels) ? raw.levels : []).entries()) {
    const at = `levels[${li}]`
    if (!isObj(entry)) { bad.push(`${at}: must be an object`); continue }
    const path = str(entry.path) ? entry.path : li === 0 ? '' : null
    if (path === null) { bad.push(`${at}.path: required ('' for the root level)`); continue }
    if (seenPaths.has(path)) { bad.push(`${at}.path: duplicate level "${path}"`); continue }
    seenPaths.add(path)

    const nodes = Array.isArray(entry.nodes) ? entry.nodes : []
    if (!nodes.length) bad.push(`${at}.nodes: at least one node is required`)
    const ids = new Set<string>()
    for (const [ni, node] of nodes.entries()) {
      const nAt = `${at}.nodes[${ni}]`
      if (!isObj(node)) { bad.push(`${nAt}: must be an object`); continue }
      if (!str(node.id) || !ID.test(node.id)) bad.push(`${nAt}.id: required, [A-Za-z0-9][A-Za-z0-9_-]* (max 64)`)
      else if (ids.has(node.id)) bad.push(`${nAt}.id: duplicate node "${node.id}"`)
      else ids.add(node.id)
      if (!str(node.label) || !node.label.trim()) bad.push(`${nAt}.label: required`)
      if (!str(node.subtype) || !(node.subtype in SUBTYPE_KIND)) bad.push(`${nAt}.subtype: not a C4 subtype (${str(node.subtype) ? node.subtype : 'missing'})`)
      for (const key of ['tech', 'desc', 'identity', 'group'] as const) {
        if (node[key] !== undefined && !str(node[key])) bad.push(`${nAt}.${key}: must be a string when present`)
      }
      if (node.rank !== undefined && (typeof node.rank !== 'number' || !Number.isInteger(node.rank) || node.rank < 0)) {
        bad.push(`${nAt}.rank: must be a non-negative integer when present`)
      }
    }

    const edges: LevelSpec['edges'] = []
    const seenEdges = new Set<string>()
    for (const [ei, edge] of (Array.isArray(entry.edges) ? entry.edges : []).entries()) {
      const eAt = `${at}.edges[${ei}]`
      if (!isObj(edge)) { bad.push(`${eAt}: must be an object`); continue }
      if (!str(edge.from) || !ids.has(edge.from)) bad.push(`${eAt}.from: unknown node "${String(edge.from)}"`)
      if (!str(edge.to) || !ids.has(edge.to)) bad.push(`${eAt}.to: unknown node "${String(edge.to)}"`)
      if (edge.from === edge.to) bad.push(`${eAt}: self-loop on "${String(edge.from)}" — draw it as a node property, not an edge`)
      if (edge.label !== undefined && !str(edge.label)) bad.push(`${eAt}.label: must be a string when present`)
      if (edge.style !== undefined && (!str(edge.style) || !EDGE_STYLES.includes(edge.style as EdgeStyle))) {
        bad.push(`${eAt}.style: one of ${EDGE_STYLES.join('|')}`)
      }
      const key = `${String(edge.from)}->${String(edge.to)}`
      if (seenEdges.has(key)) continue // duplicate edge: drop, do not fail
      seenEdges.add(key)
      edges.push({
        from: String(edge.from),
        to: String(edge.to),
        style: (edge.style as EdgeStyle | undefined) ?? 'flow',
        ...(edge.label !== undefined ? { label: String(edge.label) } : {}),
      })
    }

    const groups: LevelSpec['groups'] = []
    const seenGroups = new Set<string>()
    for (const [gi, group] of (Array.isArray(entry.groups) ? entry.groups : []).entries()) {
      const gAt = `${at}.groups[${gi}]`
      if (!isObj(group)) { bad.push(`${gAt}: must be an object`); continue }
      if (!str(group.id) || !ID.test(group.id)) bad.push(`${gAt}.id: required, [A-Za-z0-9][A-Za-z0-9_-]*`)
      else if (seenGroups.has(group.id)) bad.push(`${gAt}.id: duplicate group "${group.id}"`)
      else seenGroups.add(group.id)
      if (!str(group.label) || !group.label.trim()) bad.push(`${gAt}.label: required`)
      const members = Array.isArray(group.members) ? group.members.filter((m): m is string => str(m)) : []
      if (!members.length) bad.push(`${gAt}.members: at least one node id`)
      for (const m of members) if (!ids.has(m)) bad.push(`${gAt}.members: unknown node "${m}"`)
      groups.push({ id: String(group.id), label: String(group.label), members })
    }

    const flow: string[] = []
    if (entry.flow !== undefined) {
      if (!Array.isArray(entry.flow)) bad.push(`${at}.flow: must be an array of "from->to" edge keys`)
      else {
        for (const [fi, key] of entry.flow.entries()) {
          if (!str(key) || !seenEdges.has(key)) {
            bad.push(`${at}.flow[${fi}]: "${String(key)}" is not an edge of this level`)
          } else if (!flow.includes(key)) {
            flow.push(key)
          }
        }
      }
    }

    levels.push({
      path,
      ...(str(entry.title) && entry.title.trim() ? { title: entry.title } : { title: path || 'Overview' }),
      nodes: nodes.flatMap((n) => {
        if (!isObj(n) || !str(n.id) || !str(n.label) || !str(n.subtype)) return []
        const node: LevelSpec['nodes'][number] = { id: n.id, label: n.label, subtype: n.subtype as Subtype }
        if (str(n.tech)) node.tech = n.tech
        if (str(n.desc)) node.desc = n.desc
        if (str(n.identity)) node.identity = n.identity
        if (str(n.group)) node.group = n.group
        if (typeof n.rank === 'number') node.rank = n.rank
        return [node]
      }),
      edges,
      groups,
      ...(flow.length ? { flow } : {}),
    })
  }

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
      if (value === 'TB') bad.push('layout.direction: "TB" is not implemented — use "LR"')
      else if (value !== 'LR') bad.push('layout.direction: "LR"')
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

/** Every level path, root first, then by path length (parent before child). */
export function levelOrder(model: Model): LevelSpec[] {
  return [...model.levels].sort((a, b) => a.path.split('/').filter(Boolean).length - b.path.split('/').filter(Boolean).length || a.path.localeCompare(b.path))
}

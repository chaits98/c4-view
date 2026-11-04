/**
 * The lens check — is this level the *inside* of one box, or another drawing wearing a drill path?
 *
 * The gate for a model-level property: geometry gates cannot see it, because a level that re-draws
 * the layer above it is perfectly laid out. Two failure modes are common enough to have names:
 *
 *   orphan lens   the path names a node the parent does not have — nothing to click, so the drill
 *                 exists only as a URL somebody has to know
 *   layer redraw  the level contains boxes that live *outside* the host (its siblings), or the host
 *                 itself — so drilling in shows the same ring again instead of the interior
 *
 * `ports` are required of every non-root level: a drill that cannot say where its outside edges land
 * is a layer redraw by another name, and the expanded view would lose those edges silently.
 *
 * @module c4-view/lens
 */
import type { EdgeSpec, LevelSpec, Model } from './types.ts'

export interface LensReport {
  /** gating: every drill level must be a lens — the inside of exactly one box */
  problems: string[]
}

export const edgeKey = (edge: EdgeSpec): string => `${edge.from}->${edge.to}`

/** Where a level's path points: the box it is the inside of. */
export function hostOf(level: LevelSpec, model: Model): { parent?: LevelSpec; hostId: string } {
  const cut = level.path.lastIndexOf('/')
  const parentPath = cut < 0 ? '' : level.path.slice(0, cut)
  const hostId = level.path.slice(cut + 1)
  return { parent: model.levels.find((l) => l.path === parentPath), hostId }
}

export function lensReport(model: Model): LensReport {
  const problems = [
    ...model.levels.flatMap((level) => levelProblems(model, level)),
    ...flowProblems(model),
    ...identityProblems(model),
    ...descProblems(model),
  ]
  return { problems }
}

/**
 * An edge with no description still draws and still animates — it just has nothing to say while it does. The
 * narration is the product here, so this is a problem worth failing `--strict` over, not a parse error: an old
 * model keeps opening, and the agent that promised a narrated flow is told what is missing.
 */
function descProblems(model: Model): string[] {
  return model.levels.flatMap((level) => {
    const missing = level.edges.filter((edge) => !edge.desc).map((edge) => `${edge.from}->${edge.to}`)
    if (!missing.length) return []
    return [`level "${level.path || '(root)'}": ${missing.length} edge(s) with no desc — ${missing.join(', ')}`]
  })
}

/**
 * The narration is a promise about order: if a level declares `flow`, it must name every edge of that level
 * once. A short list does not fail loudly — the viewer appends the rest — so the drawing animates in an order
 * nobody chose and the reader never learns it.
 */
function flowProblems(model: Model): string[] {
  const out: string[] = []
  for (const level of model.levels) {
    if (!level.flow?.length) continue
    const keys = level.edges.map((e) => `${e.from}->${e.to}`)
    const missing = keys.filter((key) => !level.flow?.includes(key))
    if (missing.length) {
      out.push(`level "${level.path || '(root)'}": flow names ${level.flow.length} of ${keys.length} edge(s) — missing ${missing.join(', ')}`)
    }
  }
  return out
}

/**
 * One id is one element: if two levels draw the same node id they must mean the same box, with the same
 * identity. Without that, a doc is shared by two different things and hover lies.
 */
function identityProblems(model: Model): string[] {
  const seen = new Map<string, { identity?: string; where: string }>()
  const out: string[] = []
  for (const level of model.levels) {
    for (const node of level.nodes) {
      const previous = seen.get(node.id)
      if (!previous) {
        seen.set(node.id, { identity: node.identity, where: level.path || '(root)' })
        continue
      }
      if (previous.identity !== node.identity) {
        out.push(
          `node "${node.id}" is drawn on "${previous.where}" and "${level.path}" with different identities ` +
          `(${previous.identity ?? 'none'} vs ${node.identity ?? 'none'}) — one id is one element`,
        )
      }
    }
  }
  return out
}

/** Everything wrong with one level's claim to be a lens; empty for the root and for a good lens. */
function levelProblems(model: Model, level: LevelSpec): string[] {
  if (!level.path) return []
  const { parent, hostId } = hostOf(level, model)
  if (!parent) return [`level "${level.path}": parent level "${parentPathOf(level.path)}" does not exist`]
  if (!parent.nodes.some((n) => n.id === hostId)) {
    const known = parent.nodes.map((n) => n.id).join(', ')
    return [`level "${level.path}": "${hostId}" is not a node of the parent level — the drill has nothing to open (nodes there: ${known})`]
  }
  const crossing = parent.edges.filter((e) => crossesInto(e, hostId))
  // a page with no doors is not a lens: nothing enters, nothing leaves, and the frame is decoration
  if (crossing.length === 0) {
    return [`level "${level.path}": "${hostId}" has no edges on the level above — a box nothing connects to cannot be a lens`]
  }
  const ports = level.ports
  if (!ports || Object.keys(ports).length === 0) {
    return [`level "${level.path}": ${crossing.length} edge(s) cross into "${hostId}" but no ports say where they land — the expanded view would lose them`]
  }
  const problems: string[] = []
  checkPorts(level, parent, hostId, ports, problems)
  const at = `level "${level.path}"`
  const into = parent.edges.filter((e) => e.to === hostId).length
  const out = parent.edges.filter((e) => e.from === hostId).length
  const sink = parent.nodes.find((n) => n.id === hostId)?.subtype
  const naturalSink = sink === 'file-storage' || sink === 'database' || sink === 'cache' || sink === 'external-system'
  if (!naturalSink && (!into || !out)) {
    problems.push(
      `${at}: dead end — ${into ? 'nothing leaves' : 'nothing enters'} this box on the level above, so its page ` +
      `shows ${into ? 'an entry with no exit' : 'an exit with no entry'}; add the missing edge or model the box as what it is`,
    )
  }
  return problems
}

const parentPathOf = (path: string): string => path.split('/').slice(0, -1).join('/') || '(root)'
const crossesInto = (edge: EdgeSpec, hostId: string): boolean => edge.from === hostId || edge.to === hostId

/** Every edge that crosses the lens boundary needs a port, and every port needs a real edge that touches the box. */
function checkPorts(level: LevelSpec, parent: LevelSpec, hostId: string, ports: Record<string, string>, problems: string[]): void {
  const at = `level "${level.path}"`
  const declared = new Map(Object.entries(ports))
  for (const edge of parent.edges.filter((e) => crossesInto(e, hostId))) {
    if (!declared.has(edgeKey(edge))) {
      problems.push(`${at}: ports missing for parent edge "${edgeKey(edge)}" — it touches "${hostId}" and would vanish when expanded`)
    }
  }
  for (const key of declared.keys()) {
    const edge = parent.edges.find((e) => edgeKey(e) === key)
    if (!edge) problems.push(`${at}: port "${key}" is not an edge of the parent level (edges there: ${parent.edges.map(edgeKey).join(', ') || 'none'})`)
    else if (edge.from !== hostId && edge.to !== hostId) problems.push(`${at}: port "${key}" does not touch "${hostId}"`)
  }
  const ids = new Set(level.nodes.map((n) => n.id))
  if (ids.has(hostId)) problems.push(`${at}: contains "${hostId}" itself — a lens shows the inside, not the box`)
  // Same box on two levels only when BOTH say so with the same identity; a matching id with no identity is
  // an unproven duplicate and stays a problem.
  const sameBox = (n: { id: string; identity?: string }): boolean => {
    const twin = level.nodes.find((c) => c.id === n.id)
    return Boolean(n.identity) && n.identity === twin?.identity
  }
  const leaked = parent.nodes.filter((n) => n.id !== hostId && ids.has(n.id) && !sameBox(n)).map((n) => n.id)
  if (leaked.length) {
    problems.push(`${at}: re-draws ${leaked.join(', ')} from the level above — the expanded view supplies those; only the interior belongs here`)
  }
}

/** One line for the CLI, or an empty string when the model has nothing to say. */
export function lensLine(report: LensReport): string {
  return report.problems.length ? `LENS FAIL ${report.problems.length} problem(s)` : 'LENS ok'
}

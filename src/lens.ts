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
  const problems: string[] = []
  for (const level of model.levels) {
    if (!level.path) {
      if (level.ports) problems.push('level "": ports on the root level — there is nothing above it to come from')
      continue
    }
    const { parent, hostId } = hostOf(level, model)
    if (!parent) {
      problems.push(`level "${level.path}": parent level "${level.path.split('/').slice(0, -1).join('/') || '(root)'}" does not exist`)
      continue
    }
    if (!parent.nodes.some((n) => n.id === hostId)) {
      problems.push(
        `level "${level.path}": "${hostId}" is not a node of the parent level — the drill has nothing to open (nodes there: ${parent.nodes.map((n) => n.id).join(', ')})`,
      )
      continue
    }
    const crossing = parent.edges.filter((e) => e.from === hostId || e.to === hostId)
    const ports = level.ports
    if (crossing.length > 0 && (!ports || Object.keys(ports).length === 0)) {
      problems.push(
        `level "${level.path}": ${crossing.length} edge(s) cross into "${hostId}" but no ports say where they land — the expanded view would lose them`,
      )
      continue
    }
    if (!ports) continue   // a box nothing connects to needs no ports
    checkPorts(level, parent, hostId, ports, problems)
  }
  return { problems }
}

/** Every edge that crosses the lens boundary needs a port, and every port needs a real edge and node. */
function checkPorts(level: LevelSpec, parent: LevelSpec, hostId: string, ports: Record<string, string>, problems: string[]): void {
  const at = `level "${level.path}"`
  const declared = new Map(Object.entries(ports))
  const crossing = parent.edges.filter((e) => e.from === hostId || e.to === hostId)
  for (const edge of crossing) {
    if (!declared.has(edgeKey(edge))) {
      problems.push(`${at}: ports missing for parent edge "${edgeKey(edge)}" — it touches "${hostId}" and would vanish when expanded`)
    }
  }
  for (const [key, target] of declared) {
    const edge = parent.edges.find((e) => edgeKey(e) === key)
    if (!edge) problems.push(`${at}: port "${key}" is not an edge of the parent level (edges there: ${parent.edges.map(edgeKey).join(', ') || 'none'})`)
    else if (edge.from !== hostId && edge.to !== hostId) problems.push(`${at}: port "${key}" does not touch "${hostId}"`)
    if (!level.nodes.some((n) => n.id === target)) problems.push(`${at}: port "${key}" → "${target}" is not a node of this level`)
  }
  const ids = new Set(level.nodes.map((n) => n.id))
  if (ids.has(hostId)) problems.push(`${at}: contains "${hostId}" itself — a lens shows the inside, not the box`)
  const leaked = parent.nodes.filter((n) => n.id !== hostId && ids.has(n.id)).map((n) => n.id)
  if (leaked.length) {
    problems.push(`${at}: re-draws ${leaked.join(', ')} from the level above — the expanded view supplies those; only the interior belongs here`)
  }
}

/** One line for the CLI, or an empty string when the model has nothing to say. */
export function lensLine(report: LensReport): string {
  return report.problems.length ? `LENS FAIL ${report.problems.length} problem(s)` : 'LENS ok'
}

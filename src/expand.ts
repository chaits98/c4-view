/**
 * Expansion — one box opened in place, with the rest of its parent still around it.
 *
 * A drill used to replace the whole canvas: the parent's neighbours and the edges that crossed the
 * boundary simply vanished. This module composes the two levels into ONE level the existing pipeline
 * can lay out, so the ring keeps its information and the host becomes a dashed frame around its own
 * interior:
 *
 *   parent nodes, minus the host  +  the child's nodes (ids prefixed)  +  a group for the frame
 *   parent edges re-attached through `ports`  +  the child's own edges
 *
 * No nested layout engine, no second coordinate system: the frame is a `GroupSpec`, which the renderer
 * already draws as a dashed boundary around exactly its members. Every geometry gate then applies to
 * the expanded picture as it does to any other level, and the result is deterministic.
 *
 * Deliberate v1 limits (ponytail): one frame at a time, the child's own groups are flattened into the
 * frame, and the child's flow is spliced in once at the host's first outgoing edge.
 *
 * @module c4-view/expand
 */
import type { EdgeSpec, LevelSpec, Model, NodeSpec } from './types.ts'
import { edgeKey, hostOf } from './lens.ts'

/** A composed level, plus the frame the renderer will draw as a dashed boundary. */
export interface Expansion {
  level: LevelSpec
  /** id of the synthetic boundary; the host's box no longer exists as a node */
  frameId: string
  frameLabel: string
}

const prefix = (host: string, id: string): string => `${host}/${id}`

/**
 * Compose `path`'s parent level with `path`'s own level. Throws with a named reason when the model
 * cannot support it — the lens check reports the same reasons, so this is the defensive path.
 */
export function expandLevel(model: Model, path: string): Expansion {
  const child = model.levels.find((l) => l.path === path)
  if (!child) throw new Error(`no level "${path}" — this model has: ${model.levels.map((l) => l.path || '(root)').join(', ')}`)
  const { parent, hostId } = hostOf(child, model)
  if (!parent) throw new Error(`level "${path}" has no parent level to expand into`)
  const host = parent.nodes.find((n) => n.id === hostId)
  if (!host) throw new Error(`level "${path}": "${hostId}" is not a node of the parent level`)
  const crossing = parent.edges.filter((e) => e.from === hostId || e.to === hostId)
  if (crossing.length > 0 && (!child.ports || Object.keys(child.ports).length === 0)) {
    throw new Error(`level "${path}" declares no ports — without them its outside edges would vanish when expanded`)
  }

  const inner = new Map(child.nodes.map((n) => [n.id, prefix(hostId, n.id)]))
  // The lens shows what goes in and what comes out, not every sibling of the parent: an unrelated box on
  // this page is noise that argues the drawer could not tell the two apart.
  const witness = new Set<string>()
  for (const edge of crossing) {
    witness.add(edge.from)
    witness.add(edge.to)
  }
  witness.delete(hostId)
  const outside = parent.nodes.filter((n) => witness.has(n.id)).map(cloneNode)
  const inside = child.nodes.map((node) => ({ ...cloneNode(node), id: inner.get(node.id)!, group: undefined }))

  const frameId = `frame-${hostId}`
  const groups = (parent.groups ?? [])
    .map((group) => ({ ...group, members: group.members.filter((member) => member !== hostId) }))
    .filter((group) => group.members.length > 0)
  groups.push({ id: frameId, label: host.label, members: [...inner.values()] })

  // parent edge key -> composed edge key, so the narration order can follow the re-attached edges
  const remapped = new Map<string, string>()
  const outerEdges = parent.edges
    .filter((edge) => edge.from === hostId || edge.to === hostId)
    .map((edge) => {
      const out = remap(edge, hostId, inner, child)
      remapped.set(edgeKey(edge), edgeKey(out))
      return out
    })
  const edges = [...outerEdges, ...child.edges.map((edge) => ({ ...edge, from: inner.get(edge.from)!, to: inner.get(edge.to)! }))]

  const flow = composedFlow(parent, child, inner, remapped) ?? []
  return {
    frameId,
    frameLabel: host.label,
    level: {
      path: child.path,
      title: `${host.label} — expanded`,
      nodes: [...outside, ...inside],
      edges,
      groups,
      flow,
    },
  }
}

/** A parent edge that touches the host keeps its outside end and lands on the port's interior node. */
function remap(edge: EdgeSpec, hostId: string, inner: Map<string, string>, child: LevelSpec): EdgeSpec {
  // only edges that touch the host are remapped; the caller filters the rest out
  const port = child.ports?.[edgeKey(edge)]
  if (!port) throw new Error(`level "${child.path}": edge "${edgeKey(edge)}" touches "${hostId}" but has no port`)
  const mapped = inner.get(port)
  if (!mapped) throw new Error(`level "${child.path}": port for "${edgeKey(edge)}" points at "${port}", which is not in the level`)
  return edge.from === hostId ? { ...edge, from: mapped } : { ...edge, to: mapped }
}

/**
 * The narration order for the composed picture: the parent's own order, with the child's flow spliced
 * in where the packet first enters the host. One splice, not one per crossing.
 */
function composedFlow(parent: LevelSpec, child: LevelSpec, inner: Map<string, string>, remapped: Map<string, string>): string[] | undefined {
  // the parser refuses a flow key that is not an edge between two nodes of this level, so both ends are in
  // `inner` by construction; a hand-built model that breaks that shows up as an undefined id, not a crash
  const childFlow = (child.flow ?? []).map((key) => {
    const [from, to] = key.split('->')
    return `${inner.get(from) as string}->${inner.get(to) as string}`
  })
  if (!parent.flow?.length && !childFlow.length) return undefined
  const parentFlow = (parent.flow ?? []).map((key) => remapped.get(key) ?? key) // coverage:invariant — empty default for a parent with no flow; both arms run, V8 reports the block as 0
  const hostId = child.path.split('/').pop()
  const enterAt = parentFlow.findIndex((key) => {
    const [from, to] = key.split('->')
    return to.startsWith(`${hostId}/`) || from.startsWith(`${hostId}/`)
  })
  const cut = enterAt < 0 ? parentFlow.length : enterAt + 1
  return [...parentFlow.slice(0, cut), ...childFlow, ...parentFlow.slice(cut)]
}

const cloneNode = (node: NodeSpec): NodeSpec => ({ ...node })

/**
 * Per-node and per-edge docs, read from beside the model.
 *
 *   docs/c4/shop.json          the model
 *   docs/c4/shop/nodes/api.md  what the hover panel shows for `api`
 *   docs/c4/shop/edges/web__api.md   …and for `web -> api`
 *
 * The docs live in the same repo as the model on purpose: they are part of what the code says about
 * itself, they diff with it, and a reviewer reads them without the tool. `__` separates the edge ends
 * because `>` is a shell redirect and model ids cannot contain `__`.
 *
 * @module c4-view/docs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { markdown } from './markdown.ts'
import type { LevelSpec, Model } from './types.ts'

/** Where a model's docs live: a directory named after the model id, beside the model file. */
export const docsDir = (modelFile: string, model: Model): string => join(dirname(modelFile), model.id)

export const nodeDocPath = (dir: string, nodeId: string): string => join(dir, 'nodes', `${nodeId}.md`)
export const edgeDocPath = (dir: string, from: string, to: string): string => join(dir, 'edges', `${from}__${to}.md`)

/** The text of one doc, or undefined when the file is absent. */
export function readDoc(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : undefined
  } catch {
    return undefined
  }
}

/** What the hover panel needs for one level: rendered HTML per node and per edge. */
export interface LevelDocs {
  nodes: Record<string, string>
  edges: Record<string, string>
}

/**
 * The hover panel already prints the node's own label, so a doc that opens with `# Same Name` would say
 * it twice. Drop that first heading when it is plain (no link, no emphasis) — the prose starts below it.
 */
export function stripLeadingHeading(source: string): string {
  const newline = source.indexOf('\n')
  if (newline < 0) return source
  const first = source.slice(0, newline).trim()
  const heading = first.startsWith('#') && !first.includes('`') && !first.includes('[') && !first.includes('*')
  if (!heading) return source
  return source.slice(newline + 1).replace(/^\s*\n/, '')
}

export function levelDocs(dir: string, level: LevelSpec): LevelDocs {
  const nodes: Record<string, string> = {}
  const edges: Record<string, string> = {}
  for (const node of level.nodes) {
    const source = readDoc(nodeDocPath(dir, node.id))
    if (source) nodes[node.id] = markdown(stripLeadingHeading(source))
  }
  for (const edge of level.edges) {
    const source = readDoc(edgeDocPath(dir, edge.from, edge.to))
    if (source) edges[`${edge.from}->${edge.to}`] = markdown(stripLeadingHeading(source))
  }
  return { nodes, edges }
}

/** A doc problem: the level, what is missing, and the path it should live at. */
export interface DocsProblem {
  where: string
  path: string
}

/**
 * Every node and edge of every level must have a doc with something in it. Presence and non-emptiness are
 * all a gate can honestly check; whether the words are any good is a reviewer's job.
 */
export function docsProblems(dir: string, model: Model): DocsProblem[] {
  const problems: DocsProblem[] = []
  for (const level of model.levels) {
    const where = level.path || '(root)'
    for (const node of level.nodes) {
      const path = nodeDocPath(dir, node.id)
      if (!hasText(path)) problems.push({ where, path })
    }
    for (const edge of level.edges) {
      const path = edgeDocPath(dir, edge.from, edge.to)
      if (!hasText(path)) problems.push({ where, path })
    }
  }
  return problems
}

function hasText(path: string): boolean {
  const source = readDoc(path)
  return source !== undefined && source.replace(/<!--[\s\S]*?-->/g, '').trim().length > 0
}

/** Counts, for the doctor and for a "docs: 41 node, 38 edge" line. */
export function docsCounts(dir: string): { nodes: number; edges: number } {
  const count = (sub: string): number => {
    const at = join(dir, sub)
    return existsSync(at) ? readdirSync(at).filter((file) => file.endsWith('.md')).length : 0
  }
  return { nodes: count('nodes'), edges: count('edges') }
}

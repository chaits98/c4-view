/**
 * The full view — every level opened in place at once.
 *
 * A drill shows one frame; this shows all of them, nested, in a single picture: the root's boxes, with each
 * container's components inside its dashed frame, and their frames inside those. It is the same composition
 * the drill uses (`composeInto`), applied bottom-up, so there is no second layout engine and every gate still
 * applies to the result.
 *
 * @module c4-view/expand-all
 */
import type { LevelSpec, Model } from './types.ts'
import { composeInto } from './expand.ts'

/** Direct children of a level path: `a` for '', `a/b` for 'a'. */
const childrenOf = (model: Model, path: string): LevelSpec[] =>
  model.levels.filter((l) => l.path !== path && parentPath(l.path) === path)

/** The path without its last segment; the root's parent is itself. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

/**
 * The level at `path` with every descendant composed into it. Bottom-up, so a child arrives already holding
 * its own frames and the parent only has to nest them.
 */
export function composeAll(model: Model, path = ''): LevelSpec {
  const level = model.levels.find((l) => l.path === path)
  // coverage:invariant — fullView always starts at the root, and parseModel always produces one
  if (!level) throw new Error(`no level "${path}" — this model has: ${model.levels.map((l) => l.path || '(root)').join(', ')}`)
  let out: LevelSpec = { ...level }
  for (const child of childrenOf(model, path)) {
    const hostId = child.path.slice(parentPath(child.path).length + (path ? 1 : 0))
    out = composeInto(out, composeAll(model, child.path), hostId, true).level
  }
  return out
}

/** The whole model as one picture, titled for the page it becomes. */
export function fullView(model: Model): LevelSpec {
  const composed = composeAll(model, '')
  return { ...composed, path: 'full', title: `${model.title} — every level` }
}

/**
 * The store: one directory per diagram, `model.json` inside it. Small on purpose — the server reads, the CLI
 * writes, and nothing here decides what a diagram means.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModelError, levelOrder, parseModel } from './model.ts'
import type { Model } from './types.ts'

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export const modelFile = (root: string, id: string): string => join(root, id, 'model.json')

/** Write `.tmp` then rename: a reader never sees half a model. */
export function save(root: string, id: string, raw: string): void {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  // uniqueness, not unpredictability: a uuid cannot collide between two processes writing the same id
  const tmp = join(dir, `.model.${randomUUID()}.tmp`)
  writeFileSync(tmp, raw)
  renameSync(tmp, modelFile(root, id))
}

/**
 * A diagram on disk, or null when there is no file. A file that exists but does not parse THROWS on purpose:
 * that is a broken store, and the page route answers 500 naming the file rather than pretending it is absent.
 */
export function loadModel(root: string, id: string): Model | null {
  const file = modelFile(root, id)
  return existsSync(file) ? parseModel(JSON.parse(readFileSync(file, 'utf8'))) : null
}

export interface Summary {
  id: string
  title: string
  levels: string[]
  created: string
  updated: string
  /** pinned to the front of the grid by the reader, not by the model */
  pinned: boolean
}

/** One file for every pin: a diagram directory stays a model and its docs, nothing else. */
const PINS = '.pins.json'

/** The ids the reader pinned. A missing or unreadable file is an empty list, never an error. */
export function pinnedIds(root: string): Set<string> {
  const file = join(root, PINS)
  if (!existsSync(file)) return new Set()
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const list = (parsed as { pinned?: unknown }).pinned
    if (!Array.isArray(list)) return new Set()
    return new Set(list.filter((id): id is string => typeof id === 'string' && ID.test(id)))
  } catch {
    return new Set()
  }
}

/** Pin or unpin one id. Returns the new state; `false` means the id is not in the store. */
export function setPinned(root: string, id: string, on: boolean): boolean {
  if (!existsSync(modelFile(root, id))) return false
  const ids = pinnedIds(root)
  if (on) ids.add(id)
  else ids.delete(id)
  // sorted, so the file diffs cleanly and two runs of the same clicks write the same bytes
  writeFileSync(join(root, PINS), JSON.stringify({ pinned: [...ids].sort() }, null, 2) + '\n')
  return ids.has(id)
}

/** Remove a diagram and everything beside it. */
export function remove(root: string, id: string): boolean {
  if (!ID.test(id) || !existsSync(modelFile(root, id))) return false
  rmSync(join(root, id), { recursive: true, force: true })
  const ids = pinnedIds(root)
  if (ids.delete(id)) writeFileSync(join(root, PINS), JSON.stringify({ pinned: [...ids].sort() }, null, 2) + '\n')
  return true
}

/**
 * Diagrams the store holds that cannot be read under the current rules.
 *
 * A model that parses but breaks a rule (an edge with no `desc`, a subtype that was removed) is not corrupt —
 * it is out of date — and hiding it is the worst answer: the grid looks like the data is gone. The page says
 * which ones are excluded and why, and `c4v audit <id>` names the exact edges.
 */
export function unreadable(root: string): Array<{ id: string; reason: string }> {
  if (!existsSync(root)) return []
  const out: Array<{ id: string; reason: string }> = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = modelFile(root, entry.name)
    if (!entry.isDirectory() || !ID.test(entry.name) || !existsSync(file)) continue
    try {
      parseModel(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      const first = error instanceof ModelError ? error.problems[0] : 'not readable'
      out.push({ id: entry.name, reason: first ?? 'not readable' })
    }
  }
  return out
}

export function list(root: string): Summary[] {
  if (!existsSync(root)) return []
  const out: Summary[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = modelFile(root, entry.name)
    if (!entry.isDirectory() || !ID.test(entry.name) || !existsSync(file)) continue
    try {
      const model = parseModel(JSON.parse(readFileSync(file, 'utf8')))
      const stat = statSync(file)
      // birthtime is the honest answer; a filesystem that does not record it reports 0, so say the same
      // thing the updated column says rather than "1 Jan 1970"
      const created = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs // coverage:invariant — every filesystem this runs on records a birth time; the 0 arm is for ones that do not
      out.push({
        id: entry.name,
        title: model.title,
        levels: levelOrder(model).map((l) => l.path),
        created: new Date(created).toISOString(),
        updated: new Date(stat.mtimeMs).toISOString(),
        pinned: false,
      })
    } catch {
      // a corrupt or half-written file must not take the listing down
    }
  }
  const pins = pinnedIds(root)
  for (const row of out) row.pinned = pins.has(row.id)
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

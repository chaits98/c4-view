/**
 * The store: one directory per diagram, `model.json` inside it. Small on purpose — the server reads, the CLI
 * writes, and nothing here decides what a diagram means.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { levelOrder, parseModel } from './model.ts'
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
  updated: string
}

export function list(root: string): Summary[] {
  if (!existsSync(root)) return []
  const out: Summary[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = modelFile(root, entry.name)
    if (!entry.isDirectory() || !ID.test(entry.name) || !existsSync(file)) continue
    try {
      const model = parseModel(JSON.parse(readFileSync(file, 'utf8')))
      out.push({ id: entry.name, title: model.title, levels: levelOrder(model).map((l) => l.path), updated: new Date(statSync(file).mtimeMs).toISOString() })
    } catch {
      // a corrupt or half-written file must not take the listing down
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

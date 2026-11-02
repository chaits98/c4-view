/**
 * `c4v publish <model.json>` — put a repo's model AND its docs into the viewer's store.
 *
 * The store and a repo keep the same information in two layouts, and nothing bridged them: `POST` copies the
 * model body only, while every page reads hover text from `<store>/<id>/<model-id>/nodes|edges`. So a repo
 * with 30 carefully written docs looked exactly like a model with none the moment you opened it in the viewer.
 *
 * @module c4-view/cli-publish
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { docsDir } from './docs.ts'
import { readModel } from './render.ts'
import { modelFile, save } from './store.ts'

const flag = (argv: string[], name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : undefined
}

/** Copy one doc directory, returning how many files landed. */
function copyDocs(from: string, to: string): number {
  if (!existsSync(from)) return 0
  mkdirSync(to, { recursive: true })
  let n = 0
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    copyFileSync(join(from, entry.name), join(to, entry.name))
    n += 1
  }
  return n
}

export function publishCommand(argv: string[], home: string = homedir()): number {
  const file = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
  if (!file) {
    console.error('usage: c4v publish <model.json> [--root ~/.c4-view]')
    return 2
  }
  const root = flag(argv, 'root') ?? join(home, '.c4-view')
  let model
  try {
    model = readModel(file)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  // the source docs sit beside the model file, keyed by the id the file carries NOW; --as renames the stored
  // diagram without losing its docs
  const source = docsDir(file, model)
  const as = flag(argv, 'as')
  if (as) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(as)) {
      console.error('--as must be lowercase letters, digits and dashes')
      return 2
    }
    model = { ...model, id: as }
  }
  save(root, model.id, JSON.stringify(model, null, 2) + '\n')
  const target = join(dirname(modelFile(root, model.id)), model.id)
  const nodes = copyDocs(join(source, 'nodes'), join(target, 'nodes'))
  const edges = copyDocs(join(source, 'edges'), join(target, 'edges'))
  console.log(`published ${model.id} → ${modelFile(root, model.id)}`)
  console.log(`  docs: ${nodes} node, ${edges} edge${nodes + edges === 0 ? ' (none beside the model — hover will be empty)' : ''}`)
  console.log(`  open: /d/${model.id}  (${model.levels.length} level${model.levels.length === 1 ? '' : 's'})`)
  return 0
}

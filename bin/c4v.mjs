#!/usr/bin/env node
/**
 * `c4v` — the entry point, deliberately plain JavaScript.
 *
 * Two things it must get right on a machine it has never seen:
 *
 * 1. Node refuses to strip types for files under `node_modules`, so a globally installed
 *    package cannot run `src/*.ts` at all. The published tarball therefore ships `dist/`
 *    (plain JS from `npm run build`) and this file prefers it. A repo checkout has no
 *    `dist/`, so it falls back to the TypeScript source, which needs Node >= 22.18.
 * 2. A version guard inside a `.ts` file can never run on an old Node (the file fails to
 *    parse first), so the check lives here, before anything is imported.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const built = join(here, '..', 'dist', 'cli.js')
const source = join(here, '..', 'src', 'cli.ts')
const [major, minor] = process.versions.node.split('.').map(Number)

/** Print what to install, then stop. */
function die(need, hint) {
  console.error(`c4v needs Node >= ${need} here; this is v${process.versions.node}.\n\n  ${hint}\n  then: c4v doctor\n`)
  process.exit(1)
}

const entry = existsSync(built) ? built : source
if (entry === source && (major < 22 || (major === 22 && minor < 18))) {
  die('22.18', 'nvm install 22 && nvm use 22   # or any Node >= 23.6')
}
if (major < 18) die('18', 'install Node 18+ (nvm install 22)')

const { run } = await import(entry)
process.exit(await run(process.argv.slice(2)))

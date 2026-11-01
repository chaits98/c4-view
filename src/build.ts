/**
 * Which build is serving. A viewer left running from an older checkout draws old pictures while the CLI
 * next to it reports the new ones; `/health` says which is which so a stale process is visible, not guessed.
 */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function buildStamp(): string {
  try {
    const meta = fileURLToPath(new URL('../package.json', import.meta.url))
    const version = (JSON.parse(readFileSync(meta, 'utf8')) as { version: string }).version
    return `${version}+${Math.round(statSync(fileURLToPath(import.meta.url)).mtimeMs / 1000)}`
  } catch {
    return 'dev'
  }
}

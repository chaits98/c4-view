/**
 * Which build is serving. A viewer left running from an older checkout draws old pictures while the CLI
 * next to it reports the new ones; `/health` says which is which so a stale process is visible, not guessed.
 *
 * `read` is a seam: the only interesting failure is a checkout with no readable package.json, and a test
 * cannot delete the real one.
 */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function buildStamp(read: (file: string) => string = (file) => readFileSync(file, 'utf8')): string {
  try {
    const version = (JSON.parse(read(fileURLToPath(new URL('../package.json', import.meta.url)))) as { version: string }).version
    return `${version}+${Math.round(statSync(fileURLToPath(import.meta.url)).mtimeMs / 1000)}`
  } catch {
    return 'dev'
  }
}

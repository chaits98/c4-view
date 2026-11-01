/**
 * Which build is serving. Read ONCE at import, together with the process start time: a viewer left running
 * from an older checkout keeps reporting the version it loaded, so `/health` names a stale process instead of
 * the one somebody hoped was running.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const META = (): string => fileURLToPath(new URL('../package.json', import.meta.url))
const STARTED = Math.round(Date.now() - process.uptime() * 1000)

/** The version in package.json, or `dev` where there is none (a test seam: no real checkout can prove this). */
export function readVersion(read: (file: string) => string = (file) => readFileSync(file, 'utf8')): string {
  try {
    return (JSON.parse(read(META())) as { version: string }).version
  } catch {
    return 'dev'
  }
}

const LOADED = readVersion()

/** `version@startedAt` for the RUNNING process, frozen at import. */
export const buildStamp = (): string => `${LOADED}@${STARTED}`

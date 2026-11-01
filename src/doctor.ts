/**
 * `c4v doctor` — what a fresh machine is missing, in one screen.
 *
 * The layout is computed from a committed font table and the runtime has no
 * dependencies, so the only real ways a new system fails are: an old Node that
 * cannot run a `.ts` file, missing viewer assets, an unwritable store, or no
 * browser for PNG. Each gets a check that says which, and how to fix it.
 *
 * @module c4-view/doctor
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { arch, homedir, platform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lineHeight, textWidth } from './metrics.ts'
import { CHROMIUM_ENV, findChromium } from './png.ts'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ASSETS = ['viewer.html', 'viewer.js', 'flow.js', 'viewer.css', 'index.html', 'index.css']

/** `dist/` is plain JS (Node 18+); the TypeScript source needs the version that strips types. */
const BUILT = import.meta.url.includes('/dist/')
const NODE_MAJOR = BUILT ? 18 : 22
const NODE_MINOR = BUILT ? 0 : 18

export interface Check {
  name: string
  ok: boolean
  required: boolean
  detail: string
}

/** Which of the two entries is loaded decides the Node floor. */
const BUILD_KIND = BUILT ? 'compiled build' : 'TypeScript source'

function nodeCheck(): Check {
  const [major, minor] = process.versions.node.split('.').map(Number)
  const ok = major > NODE_MAJOR || (major === NODE_MAJOR && minor >= NODE_MINOR)
  const detail = ok
    ? `v${process.versions.node} — running the ${BUILD_KIND}`
    : `v${process.versions.node} — needs >=${NODE_MAJOR}.${NODE_MINOR}: nvm install 22 && nvm use 22`
  return { name: 'node', ok, required: true, detail }
}

function assetCheck(): Check {
  const missing = ASSETS.filter((file) => !existsSync(join(PUBLIC, file)))
  return {
    name: 'assets',
    ok: missing.length === 0,
    required: true,
    detail: missing.length ? `missing ${missing.join(', ')} in ${PUBLIC}` : `${ASSETS.length} viewer files in ${PUBLIC}`,
  }
}

function fontCheck(): Check {
  const width = textWidth('Ranked AuditReport', 13)
  const ok = Number.isFinite(width) && width > 0 && lineHeight(13) > 0
  return {
    name: 'font table',
    ok,
    required: true,
    detail: ok ? `DejaVu metrics, width probe = ${width}` : 'data/font-metrics.json is empty — run scripts/gen-metrics.py',
  }
}

function storeCheck(root: string): Check {
  const probe = join(root, '.doctor-probe')
  try {
    mkdirSync(join(root, 'scratch'), { recursive: true }) // scratch lives beside the preferences, not in the user's repo
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    return { name: 'store', ok: true, required: true, detail: `${root} is writable (scratch: ${join(root, 'scratch')})` }
  } catch (error) {
    return { name: 'store', ok: false, required: true, detail: `${root} — ${error instanceof Error ? error.message : String(error)}` }
  }
}

function chromiumCheck(): Check {
  const browser = findChromium()
  const ok = browser !== null && existsSync(browser)
  return {
    name: 'chromium',
    ok,
    required: false,
    detail: ok ? `${browser} — PNG export available` : `none — PNG export off; set ${CHROMIUM_ENV}=/path/to/chrome (SVG is unaffected)`,
  }
}

/** Every check, in the order a failure would bite. */
export function checks(root: string = join(homedir(), '.c4-view')): Check[] {
  return [nodeCheck(), assetCheck(), fontCheck(), storeCheck(root), chromiumCheck()]
}

/** ok, FAIL for a broken requirement, note for an optional absence. */
function markOf(row: Check): string {
  if (row.ok) return 'ok  '
  return row.required ? 'FAIL' : 'note'
}

/** Print one line per check; true when every REQUIRED check passed. */
export function doctor(root: string): boolean {
  const rows = checks(root)
  console.log(`c4v doctor — ${platform()} ${arch()}, node v${process.versions.node}`)
  for (const row of rows) console.log(`  ${markOf(row)}  ${row.name.padEnd(10)} ${row.detail}`)
  const failed = rows.filter((row) => row.required && !row.ok)
  console.log(failed.length ? `\n${failed.length} required check(s) failed` : '\nevery requirement met')
  return failed.length === 0
}

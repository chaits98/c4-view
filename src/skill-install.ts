/**
 * Install the skill into whichever harnesses this machine actually has.
 *
 * The harness list is DATA (`skill/harnesses.jsonl`), not code: adding a harness is one line, and the
 * installer, the `--global` flag, the detection and the docs all pick it up. That is the whole design —
 * a hardcoded list is how a tool ends up supporting exactly the two harnesses its author used.
 *
 * Two scopes:
 *   global   a user-level directory, visible to every project on the machine
 *   project  `.agents/skills/c4-diagram` inside the current repo, committed with the code
 *
 * @module c4-view/skill-install
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Harness {
  id: string
  label: string
  scope: 'global' | 'project'
  /** where the skill directory goes; `~` and relative paths are resolved here */
  dir: string
  kind: 'dir'
  note?: string
  /** a path whose existence suggests the harness is installed here */
  detect?: string
}

const ROOT = fileURLToPath(new URL('../skill/', import.meta.url))

/** Every harness the tool knows how to install into. Bare lines only; the file is the registry. */
export function harnesses(file = join(ROOT, 'harnesses.jsonl')): Harness[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Harness)
}

/** `~` and `~/x` expand against the *current* home, so a test can point HOME somewhere harmless. */
export function expand(target: string, home = homedir(), cwd = process.cwd()): string {
  if (target === '~') return home
  if (target.startsWith('~/')) return join(home, target.slice(2))
  return resolve(cwd, target)
}

export const installed = (harness: Harness, home = homedir(), cwd = process.cwd()): boolean =>
  existsSync(expand(harness.dir, home, cwd))

/** A harness counts as present when its marker exists — a bare directory is not enough evidence. */
export const detected = (harness: Harness, home = homedir()): boolean =>
  harness.detect ? existsSync(expand(harness.detect, home)) : false

/** The version an installed copy was written from: a copy is text, so an upgrade does not touch it. */
export const installedVersion = (harness: Harness, home = homedir(), cwd = process.cwd()): string | null => {
  const file = join(expand(harness.dir, home, cwd), 'VERSION')
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
}

/** Copy the skill (SKILL.md + assets/ + preferences.jsonl) into one target, replacing a previous version. */
export function installInto(harness: Harness, home = homedir(), cwd = process.cwd(), version?: string): string {
  const target = expand(harness.dir, home, cwd)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(ROOT)) {
    if (entry === 'SMOKE-PROMPT.md') continue // a test harness document, not part of the shipped skill
    cpSync(join(ROOT, entry), join(target, entry), { recursive: true })
  }
  // a copy does not follow the package: stamp what wrote it, so `skill list` can say it is behind
  if (version) writeFileSync(join(target, 'VERSION'), `${version}\n`)
  return target
}

export interface InstallPlan {
  harness: Harness
  target: string
  reason: 'named' | 'detected' | 'global'
}

/**
 * Which harnesses to write, and why. `--global` means "every global harness that is present"; naming
 * harnesses means "these, whether or not detection is sure"; project scope is never implied.
 */
export function plan(all: Harness[], opts: { global?: boolean; named?: string[]; home?: string; cwd?: string }): InstallPlan[] {
  const home = opts.home ?? homedir()
  const cwd = opts.cwd ?? process.cwd()
  const named = new Set(opts.named ?? [])
  const chosen: InstallPlan[] = []
  for (const harness of all) {
    const target = expand(harness.dir, home, cwd)
    if (named.has(harness.id)) {
      chosen.push({ harness, target, reason: 'named' })
      continue
    }
    if (!opts.global || harness.scope !== 'global') continue
    if (detected(harness, home)) chosen.push({ harness, target, reason: 'detected' })
  }
  return chosen
}

/** One line per harness, for `c4v skill list`. */
export function describe(all: Harness[], opts: { home?: string; cwd?: string; version?: string } = {}): string[] {
  const home = opts.home ?? homedir()
  const cwd = opts.cwd ?? process.cwd()
  return all.map((harness) => {
    const here = detected(harness, home) ? 'present' : 'absent '
    let done = installed(harness, home, cwd) ? 'installed' : '—        '
    // the installed copy is a copy: after an upgrade it keeps the instructions it was written with
    if (done === 'installed' && opts.version) {
      const at = installedVersion(harness, home, cwd)
      if (!at) done = 'unversioned'
      else if (at !== opts.version) done = `stale ${at}`
    }
    return `  ${harness.id.padEnd(12)} ${here}  ${done.padEnd(9)}  ${harness.label}`
  })
}

/** Sanity check used by tests and by `skill install`: the source really is a skill. */
export function isSkillDir(dir = ROOT): boolean {
  if (!existsSync(join(dir, 'SKILL.md'))) return false
  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  return /^---[\s\S]*?name:\s*c4-diagram/m.test(text) && statSync(join(dir, 'SKILL.md')).isFile()
}

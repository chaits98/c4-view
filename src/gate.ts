/**
 * The repo gate — optional, user's choice, and useless without a record when it is skipped.
 *
 * A diagram is only worth anything while it matches the code. Nothing enforces that on its own: the model
 * and its docs sit in `docs/c4/`, the code changes next to them, and the two drift silently. So a repo can
 * install a pre-commit gate that asks ONE question per commit:
 *
 *   does this commit touch code outside docs/c4?  →  then it also updates docs/c4, or says why not.
 *
 * "Says why not" is a DEFERRAL: one recorded line, tied to the exact staged diff, so it cannot silently
 * cover later edits. An agent can lie in the reason — a gate cannot read intent — but the lie is written
 * down, reviewable, and listed by `c4v gate report`.
 *
 * Nothing here installs itself. `c4v gate install` is the only path, and it prints every file it writes.
 *
 * @module c4-view/gate
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HOOK_FILE = '.githooks/pre-commit'
const LOG = 'docs/c4/.gate-log.jsonl'
const MODELS = 'docs/c4'

export interface Deferral {
  diff: string
  model: Record<string, string>
  reason: string
  at: string
}

/** The repository root, or a named error: a gate in the wrong directory is worse than none. */
export function repoRoot(cwd = process.cwd()): string {
  try {
    return realpathSync(execFileSync(GIT, ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim())
  } catch {
    throw new Error(`${cwd} is not inside a git repository — the gate is a pre-commit hook, so it needs one`)
  }
}

/** Absolute git, so the command cannot be hijacked by whatever happens to be first on PATH. */
const GIT = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'].find((path) => existsSync(path)) ?? '/usr/bin/git'

const git = (root: string, args: string[]): string =>
  execFileSync(GIT, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

/** What this commit actually stages. Empty means nothing is being committed (a hook run by hand). */
export interface Staged {
  files: string[]
  diff: string
}

export function staged(root: string): Staged {
  const files = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
  return { files, diff: hash(git(root, ['diff', '--cached'])) }
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Every model in the repo, and the hash of the bytes a deferral would have been made against. */
export function models(root: string): Record<string, string> {
  const dir = join(root, MODELS)
  if (!existsSync(dir)) return {}
  const out: Record<string, string> = {}
  for (const file of readdirRecursive(MODELS, root)) {
    if (!file.endsWith('.json') || file.includes('.gate-log')) continue
    out[file] = hash(readFileSync(join(root, file), 'utf8'))
  }
  return out
}

/** Every file under a repo-relative directory, as repo-relative paths. */
function readdirRecursive(dir: string, root: string, prefix = ''): string[] {
  const at = join(root, dir, prefix)
  if (!existsSync(at)) return []
  const out: string[] = []
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...readdirRecursive(dir, root, path))
    else out.push(`${dir}/${path}`)
  }
  return out
}

const touches = (files: string[], prefix: string): boolean => files.some((file) => file.startsWith(`${prefix}/`))

/** The verdict for the staged set: ok, or the one thing that would make it ok. */
export interface Verdict {
  ok: boolean
  /** a line to print whatever the verdict is */
  lines: string[]
}

export function verdict(root: string, stage: Staged = staged(root)): Verdict {
  const known = models(root)
  if (!Object.keys(known).length) return { ok: true, lines: ['gate: no diagrams in this repo yet — nothing to keep in sync'] }
  if (!stage.files.length) return { ok: true, lines: ['gate: nothing staged'] }
  if (touches(stage.files, MODELS)) return { ok: true, lines: [`gate: staged commit updates ${MODELS} ✓`] }
  const record = deferrals(root).find((entry) => entry.diff === stage.diff && sameModels(entry.model, known))
  if (record) {
    return { ok: true, lines: [`gate: deferred ✓ ${record.diff} "${record.reason}"`, `gate: model unchanged since the deferral`] }
  }
  const stale = deferrals(root).find((entry) => entry.diff === stage.diff)
  return {
    ok: false,
    lines: [
      `gate: ${stage.files.length} file(s) staged, none under ${MODELS}/`,
      stale ? 'gate: a deferral exists for this diff but the model changed since — record it again' : 'gate: either update the diagram and its docs, or record why this change does not need one:',
      `      c4v gate defer --reason "what changed and why the picture is still true"`,
    ],
  }
}

const sameModels = (a: Record<string, string>, b: Record<string, string>): boolean =>
  Object.keys(b).every((key) => a[key] === b[key]) && Object.keys(a).length === Object.keys(b).length

export function deferrals(root: string): Deferral[] {
  const file = join(root, LOG)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Deferral)
}

/** Record a deferral for exactly what is staged right now, then say what it will cover. */
export function deferGate(root: string, reason: string): Deferral {
  if (!reason.trim()) throw new Error('a deferral needs a reason — "no change needed" is not one a reviewer can check')
  const stage = staged(root)
  if (!stage.files.length) throw new Error('nothing is staged, so there is nothing to defer')
  const entry: Deferral = { diff: stage.diff, model: models(root), reason: reason.trim(), at: new Date().toISOString() }
  const file = join(root, LOG)
  mkdirSync(join(root, MODELS), { recursive: true })
  writeFileSync(file, `${JSON.stringify(entry)}\n`, { flag: 'a' })
  return entry
}

/**
 * Install the hook. Committed `.githooks/pre-commit` plus `core.hooksPath`, so it reaches the team on
 * clone; an existing hook is chained, never replaced.
 */
export function installGate(root: string): string[] {
  const lines: string[] = []
  mkdirSync(join(root, '.githooks'), { recursive: true })
  const hook = join(root, HOOK_FILE)
  const chain = existsSync(hook) ? '\n# chain whatever this repo already had here\n[ -x .git/hooks/pre-commit ] && .git/hooks/pre-commit "$@"\n' : ''
  writeFileSync(
    hook,
    `#!/bin/sh\n# c4-view: a commit that touches code must also update docs/c4 (the diagram and its docs),\n# or record one line saying why no diagram change was needed: c4v gate defer --reason "..."\n# Remove with: c4v gate uninstall\n${chain}exec c4v gate check --staged\n`,
  )
  chmodSync(hook, 0o755)
  lines.push(`wrote ${HOOK_FILE}`)
  const current = gitSafe(root, ['config', '--get', 'core.hooksPath'])
  if (current && current !== '.githooks') lines.push(`note: core.hooksPath was "${current}" — it now points at .githooks; merge your old hook into it`)
  git(root, ['config', 'core.hooksPath', '.githooks'])
  lines.push('core.hooksPath = .githooks')
  lines.push('test it with: git commit --allow-empty -m "check" (it should refuse if nothing is staged)')
  return lines
}

const gitSafe = (root: string, args: string[]): string => {
  try {
    return git(root, args).trim()
  } catch {
    return ''
  }
}

export function statusGate(root: string): string[] {
  const hook = join(root, HOOK_FILE)
  const path = gitSafe(root, ['config', '--get', 'core.hooksPath'])
  const hookLine = existsSync(hook) ? `${HOOK_FILE} ✓` : `${HOOK_FILE} — not installed`
  const pathLine = path === '.githooks' ? '.githooks ✓' : path || '(unset)'
  const lines = [
    `hook file:      ${hookLine}`,
    `core.hooksPath: ${pathLine}`,
    `models:         ${Object.keys(models(root)).length}`,
    `deferrals:      ${deferrals(root).length}`,
  ]
  const live = join(root, '.git/hooks/pre-commit')
  if (existsSync(live) && !path) lines.push('note: .git/hooks/pre-commit exists but core.hooksPath is unset — git will run that one')
  return lines
}

export function uninstallGate(root: string): string[] {
  const hook = join(root, HOOK_FILE)
  const lines: string[] = []
  if (existsSync(hook)) {
    rmSync(hook)
    lines.push(`removed ${HOOK_FILE}`)
  }
  if (gitSafe(root, ['config', '--get', 'core.hooksPath']) === '.githooks') {
    git(root, ['config', '--unset', 'core.hooksPath'])
    lines.push('core.hooksPath unset')
  }
  lines.push(`left alone: ${LOG} (the record of what was deferred stays reviewable)`)
  return lines
}

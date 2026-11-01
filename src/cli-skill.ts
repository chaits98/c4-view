/**
 * `c4v skill …` and `c4v prefs …` — the two verbs an agent needs before it can use the skill well.
 *
 * They live here rather than in cli.ts because that file is already at the size where the 300-line gate
 * starts objecting, and because both are "session furniture": install once, ask once, then get out of the way.
 *
 * @module c4-view/cli-skill
 */
import { homedir } from 'node:os'
import { describe, harnesses, installInto, installed, isSkillDir, plan } from './skill-install.ts'
import { answer, greeting, loadPrefs, pending, prefsPath, questions, savePrefs, type Prefs, type Question } from './prefs.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The version the user is now running, read from the package so it can never disagree with the release. */
function currentVersion(): string {
  try {
    const pkg = fileURLToPath(new URL('../package.json', import.meta.url))
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

/** `--flag value` / `--flag` parsing, kept local so this module has no dependency on cli.ts. */
function flags(argv: string[]): { has: (name: string) => boolean; opt: (name: string) => string | undefined; rest: string[] } {
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
  }
  const valueAt = new Set<number>()
  argv.forEach((token, i) => {
    if (token.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) valueAt.add(i + 1)
  })
  return {
    has: (name) => argv.includes(`--${name}`),
    opt,
    rest: argv.filter((token, i) => !token.startsWith('--') && !valueAt.has(i)),
  }
}

export const SKILL_USAGE = `c4v skill list                       every harness this tool can install into
c4v skill install [--global] [--harness id,id]   copy the skill into those harnesses
c4v prefs show                       the answers saved on this machine
c4v prefs pending                    questions the user has not answered yet (JSON)
c4v prefs set <id>=<value>            record one answer
c4v prefs greeting [--version x.y.z]  one sentence for the user, or nothing`

/** `skill list|install`. Returns an exit code like every other verb. */
export function skillCommand(argv: string[]): number {
  const { has, opt, rest } = flags(argv)
  const action = rest[1]
  const all = harnesses()
  if (!all.length) {
    console.error('skill/harnesses.jsonl is missing or empty — the package is damaged')
    return 1
  }
  if (action === 'list' || action === undefined) {
    console.log('  id           harness    state      label')
    for (const line of describe(all)) console.log(line)
    console.log('\n  global installs write a user-level directory; add --harness <id> for a target that is not detected')
    return 0
  }
  if (action !== 'install') {
    console.error(`unknown action "${action}"\n\n${SKILL_USAGE}`)
    return 2
  }
  if (!isSkillDir()) {
    console.error('this package does not contain a complete skill (SKILL.md + assets/)')
    return 1
  }
  const named = (opt('harness') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  const chosen = plan(all, { global: has('global') || named.length === 0, named, home: homedir() })
  if (!chosen.length) {
    console.error('no harness found. Name one: c4v skill install --harness agents')
    return 1
  }
  for (const item of chosen) {
    const target = installInto(item.harness, homedir())
    console.log(`  ${item.harness.id.padEnd(12)} ${item.reason.padEnd(8)} ${target}`)
  }
  console.log(`\n  ${chosen.length} harness(es) installed. Next: c4v prefs pending`)
  return 0
}

function prefsShow(prefs: Prefs): number {
  console.log(`store: ${prefsPath()}`)
  const entries = Object.entries(prefs.answers)
  if (!entries.length) console.log('  (nothing answered yet — run: c4v prefs pending)')
  for (const [key, value] of entries) console.log(`  ${key} = ${value}`)
  if (prefs.seen) console.log(`  (version last seen: ${prefs.seen.version})`)
  return 0
}

function prefsSet(all: Question[], prefs: Prefs, pair: string): number {
  const [id, ...valueParts] = pair.split('=')
  const value = valueParts.join('=')
  if (!id || !value) {
    console.error('usage: c4v prefs set <question-id>=<answer>')
    return 2
  }
  try {
    const next = answer(all, prefs, id, value)
    // answering stamps the version, so the NEXT release can say "updated" instead of asking again
    savePrefs({ ...next, seen: { version: currentVersion(), at: new Date().toISOString() } })
    console.log(`${id} = ${value}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
}

/** `prefs show|pending|set|greeting`. */
export function prefsCommand(argv: string[]): number {
  const { opt, rest } = flags(argv)
  const action = rest[1]
  const all = questions()
  const prefs = loadPrefs()

  if (action === 'show' || action === undefined) return prefsShow(prefs)
  if (action === 'pending') {
    const waiting = pending(all, prefs)
    console.log(JSON.stringify(waiting.map((q) => ({ id: q.id, question: q.question, options: q.options, default: q.default, why: q.why })), null, 2))
    return 0
  }
  if (action === 'greeting') {
    const version = opt('version') ?? '0.0.0'
    const line = greeting(all, prefs, version)
    if (line) console.log(line)
    return 0
  }
  if (action === 'set') return prefsSet(all, prefs, rest[2] ?? '')
  console.error(`unknown action "${action}"\n\n${SKILL_USAGE}`)
  return 2
}

/** Kept for the `installed` import so the module tree-shakes predictably in tests. */
export { installed }

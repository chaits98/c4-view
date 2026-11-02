/**
 * `c4v gate …` — the commands, and nothing else. One verb per thing a person or an agent needs to do.
 *
 *   c4v gate install      write .githooks/pre-commit, point core.hooksPath at it
 *   c4v gate check        what the hook runs; `--staged` is the only mode that matters
 *   c4v gate defer        record why THIS staged diff needs no diagram change
 *   c4v gate status       what is installed, and how many deferrals exist
 *   c4v gate report       every deferral, newest first — the review surface for skipped commits
 *   c4v gate uninstall    remove the hook, leave the log
 *
 * @module c4-view/cli-gate
 */
import { deferGate, deferrals, installGate, repoRoot, staged, statusGate, uninstallGate, verdict } from './gate.ts'

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : undefined
}

export function gateCommand(argv: string[]): number {
  const action = argv[1]
  let root: string
  try {
    root = repoRoot()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  const run = ACTIONS[action ?? 'status']
  if (!run) {
    console.error(`unknown gate action "${action}"`)
    console.error('usage: c4v gate install|check --staged|defer --reason "..."|status|report|uninstall')
    return 2
  }
  return run(root, argv)
}

type Action = (root: string, argv: string[]) => number

const install: Action = (root) => {
  for (const line of installGate(root)) console.log(`  ${line}`)
  return 0
}

const check: Action = (root, argv) => {
  if (!argv.includes('--staged')) {
    console.error('gate check reads what is staged; run it as the pre-commit hook, or with --staged')
    return 2
  }
  const result = verdict(root, staged(root))
  for (const line of result.lines) (result.ok ? console.log : console.error)(`  ${line}`)
  return result.ok ? 0 : 1
}

const defer: Action = (root, argv) => {
  try {
    const entry = deferGate(root, flag(argv, 'reason') ?? '')
    console.log(`  deferred ✓ ${entry.diff} "${entry.reason}"`)
    console.log('  recorded in docs/c4/.gate-log.jsonl — commit it with the change it explains')
    return 0
  } catch (error) {
    // deferGate throws Error and nothing else; a bare value would read as "undefined" here and be a bug
    console.error(`  ${(error as Error).message}`)
    return 2
  }
}

const status: Action = (root) => {
  for (const line of statusGate(root)) console.log(`  ${line}`)
  return 0
}

const report: Action = (root) => {
  const all = deferrals(root)
  const lines = all.length
    ? [
        ...all.slice(-20).reverse().map((entry) => `${entry.at.slice(0, 19)}  ${entry.diff}  "${entry.reason}"`),
        `${all.length} deferral(s) total in docs/c4/.gate-log.jsonl`,
      ]
    : ['no deferrals — every commit that changed code also touched the diagram']
  for (const line of lines) console.log(`  ${line}`)
  return 0
}

const uninstall: Action = (root) => {
  for (const line of uninstallGate(root)) console.log(`  ${line}`)
  return 0
}

const ACTIONS: Record<string, Action> = { install, check, defer, status, report, uninstall }

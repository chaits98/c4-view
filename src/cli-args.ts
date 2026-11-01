/**
 * Argument errors, answered before any work is done: which verbs need no model file, what `service` takes, and
 * why `--out x.svg` needs `--level`. Beside cli.ts so the dispatcher reads as a list of commands.
 */
import { extname } from 'node:path'

/** The part of the parsed command line these checks need. */
export interface Argv {
  argv: string[]
  command: string | undefined
  file: string | undefined
  has: (name: string) => boolean
  opt: (name: string) => string | undefined
}

/** Commands that answer without a model file. */
const NO_FILE = new Set(['serve', 'doctor', 'skill', 'prefs', 'gate', 'publish'])

/** Argument errors are answered before any work is done. */
export function argumentError(args: Argv, usage: string): number | null {
  if (!args.command || args.command === 'help' || args.has('help') || args.command === '--help') {
    console.log(usage)
    return 0
  }
  if (NO_FILE.has(args.command ?? '')) return null
  if (args.command === 'service') {
    const action = args.argv[1]?.startsWith('--') ? undefined : args.argv[1]
    if (action !== 'install' && action !== 'uninstall' && action !== 'status') {
      console.error(`c4v service <install|uninstall|status>\n`)
      return 2
    }
    return null
  }
  if (!args.file) {
    console.error(`missing <model.json>\n\n${usage}`)
    return 2
  }
  if (args.command !== 'render' && args.command !== 'audit') {
    console.error(`unknown command "${args.command}"\n\n${usage}`)
    return 2
  }
  const out = args.opt('out')
  if (out !== undefined && extname(out) === '.svg' && args.opt('level') === undefined) {
    console.error('--out <file.svg> needs --level (one level per file)\n')
    return 2
  }
  return null
}

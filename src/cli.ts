#!/usr/bin/env node
/**
 * `c4v` — the agent-facing door.
 *
 *   c4v render <model.json> [--level <path>] [--out <dir|file.svg>] [--png] [--scale <n>] [--strict]
 *   c4v audit  <model.json> [--json] [--strict]
 *   c4v serve  [--port 8788] [--root ~/.c4-view] [--host 127.0.0.1] [--token <t> | --no-token]
  c4v doctor [--root ~/.c4-view]     what this machine is missing, if anything
  c4v service install|uninstall|status [--port 8788] [--host 127.0.0.1] [--root ~/.c4-view]
                                     host the viewer as a systemd USER unit
  c4v skill list | install [--global] [--harness id,id]
                                     copy this skill into the AI harnesses on this machine
  c4v prefs pending | show | set <id>=<answer> | greeting
                                     the answers the user gave once (and the ones still missing)
 *
 * `--strict` exits 1 when any geometry gate fails, so a skill can make "deliver
 * only a clean diagram" mechanical instead of a promise.
 *
 * `run(args)` is exported and returns the exit code, so the command line itself is under
 * test (`test/cli.test.ts`) instead of being the one part nobody could cover.
 *
 * @module c4-view/cli
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderFile, type Rendered } from './render.ts'
import { reportCommand } from './cli-output.ts'
import type { Systemctl } from './service.ts'
import type { Model } from './types.ts'
import { ModelError, parseModel } from './model.ts'

const USAGE = `c4v — agent-driven C4 renderer

  c4v render <model.json> [--level <path>] [--out <dir|file.svg>] [--png] [--scale <n>] [--strict]
  c4v audit  <model.json> [--json] [--strict]
  c4v serve  [--port 8788] [--root ~/.c4-view] [--host 127.0.0.1] [--token <t> | --no-token]
  c4v doctor [--root ~/.c4-view]     what this machine is missing, if anything
  c4v service install|uninstall|status [--port 8788] [--host 127.0.0.1] [--root ~/.c4-view]
                                     host the viewer as a systemd USER unit
  c4v skill list | install [--global] [--harness id,id]
                                     copy this skill into the AI harnesses on this machine
  c4v prefs pending | show | set <id>=<answer> | greeting
                                     the answers the user gave once (and the ones still missing)

  --level   render one level by path (root is "")           [default: every level]
  --out     a directory, or a .svg file when one level is rendered [default: ./out/<id>]
  --png     also write a PNG beside each SVG (--scale, default 2)
  --token   bearer token; REQUIRED (auto-generated) when --host is not loopback
  --strict  exit 1 when any geometry gate fails (node∧node, wire∧node, wire∧wire, chip∧chip,
            chip∧node, group∧node)
`

/** The parsed command line: one object, so nothing has to reach for `process.argv`. */
interface Args {
  /** the raw argv, for the few commands whose second word is a verb rather than a file */
  argv: string[]
  command: string | undefined
  file: string | undefined
  has: (name: string) => boolean
  opt: (name: string) => string | undefined
  optOr: (name: string, fallback: string) => string
}

export function parseArgs(argv: string[]): Args {
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i > 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? String(argv[i + 1]) : undefined
  }
  return {
    argv,
    command: argv[0],
    file: argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined,
    has: (name) => argv.includes(`--${name}`),
    opt,
    optOr: (name, fallback) => opt(name) ?? fallback,
  }
}

/** `'' -> root`, `a/b -> a~b`: a file-safe, injective stem for one level. */
export { levelSlug as slugOf } from './slug.ts'

/** The serve command owns the process: it resolves only when the server is asked to stop. */
async function serveCommand(args: Args): Promise<number> {
  const { serve } = await import('./server.ts')
  const { guardNotice } = await import('./security.ts')
  const port = Number(args.optOr('port', '8788'))
  const root = args.optOr('root', join(homedir(), '.c4-view'))
  const host = args.optOr('host', '127.0.0.1')
  const token = args.has('no-token') ? '' : args.opt('token')
  if (args.has('no-token') && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    console.error('--no-token is only allowed on loopback: a shared viewer needs a token')
    return 2
  }
  const srv = await serve({ port, root, host, token: token === '' ? undefined : token })
  const addr = srv.address()
  const shown = typeof addr === 'object' && addr !== null ? addr.port : port
  for (const line of guardNotice(srv.guard, shown)) console.log(line)
  console.log(`  diagrams in ${root}`)
  /* node:coverage disable */
  // `serve` owns the process: it returns only through the exit below, so the promise never settles
  // in a test — the spawned-process test proves the behaviour (boots, answers, exits on SIGTERM).
  const stop = (): void => {
    srv.close(() => process.exit(0))
  }
  /* node:coverage enable */
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return await new Promise<number>(() => {})
}

/** Render the model, or print why it could not be read. */
/** The parsed model, for the checks that are about the file rather than the picture. */
function loadModel(file: string): Model | null {
  try {
    return parseModel(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function loadReport(file: string, level: string | undefined, expand?: string): Rendered | null {
  try {
    return renderFile(file, level, expand)
  } catch (error) {
    if (error instanceof ModelError) console.error(error.message)
    else console.error(error instanceof Error ? error.message : String(error))
    return null
  }
}

/** The sub-action of a two-word command (`service install`). */
function argvSecond(args: Args): string | undefined {
  return args.argv[1]?.startsWith('--') ? undefined : args.argv[1]
}

/**
 * `service install|uninstall|status` — a systemd user unit, so nothing depends on a live shell.
 *
 * `home` and `run` are seams for the test in test/cli-service.test.ts: installing into the machine
 * that runs the suite, and calling a real systemctl, are both things a test must not do.
 */
export async function serviceCommand(
  args: Args,
  seam: { home?: string; run?: Systemctl } = {},
): Promise<number> {
  const { installService, serviceHints, serviceStatus, uninstallService, ensureTokenFile } = await import('./service.ts')
  const { newToken } = await import('./security.ts')
  const home = seam.home ?? homedir()
  const unitDir = join(home, '.config', 'systemd', 'user')
  const run = seam.run ?? undefined
  const action = argvSecond(args)
  if (action === 'status') return serviceStatus(run, unitDir)
  if (action === 'uninstall') {
    console.log(uninstallService(run, unitDir) ? 'unit removed' : 'no unit installed')
    return 0
  }
  // a typo must not install: only an absent verb (the common case) means "install"
  if (action !== undefined && action !== 'install') {
    console.error(`unknown action "${action}" — use: c4v service install | uninstall | status`)
    return 2
  }
  const opts = {
    port: args.optOr('port', '8788'),
    host: args.optOr('host', '127.0.0.1'),
    root: args.optOr('root', join(home, '.c4-view')),
  }
  try {
    const file = installService(opts, run, unitDir)
    const token = ensureTokenFile(opts.host, newToken, join(home, '.config', 'c4-view'))
    console.log(`installed and started\n${file}`)
    for (const line of serviceHints(opts.port, opts.host)) console.log(`  ${line}`)
    if (token) console.log(`  token:   ${token}   (in ~/.config/c4-view/env; open once with ?t=<token>)`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/** Argument errors are answered before any work is done. */
function argumentError(args: Args): number | null {
  if (!args.command || args.command === 'help' || args.has('help') || args.command === '--help') {
    console.log(USAGE)
    return 0
  }
  if (args.command === 'serve' || args.command === 'doctor') return null
  if (args.command === 'skill' || args.command === 'prefs') return null
  if (args.command === 'service') {
    const action = argvSecond(args)
    if (action !== 'install' && action !== 'uninstall' && action !== 'status') {
      console.error(`c4v service <install|uninstall|status>\n`)
      return 2
    }
    return null
  }
  if (!args.file) {
    console.error(`missing <model.json>\n\n${USAGE}`)
    return 2
  }
  if (args.command !== 'render' && args.command !== 'audit') {
    console.error(`unknown command "${args.command}"\n\n${USAGE}`)
    return 2
  }
  const out = args.opt('out')
  if (out !== undefined && extname(out) === '.svg' && args.opt('level') === undefined) {
    console.error('--out <file.svg> needs --level (one level per file)\n')
    return 2
  }
  return null
}

/**
 * Run the command line and resolve its exit code. Never calls process.exit, and never lets an
 * unexpected error escape as a rejection: a tool failure is a one-line message plus a code, or the
 * user sees a stack trace from inside `node_modules` and has nothing to act on.
 */
export async function run(argv: string[]): Promise<number> {
  try {
    return await dispatch(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/** Verbs that run before (and instead of) the render pipeline. null means "not one of mine". */
async function otherCommand(args: Args, argv: string[]): Promise<number | null> {
  switch (args.command) {
    case 'serve': return serveCommand(args)
    case 'skill': {
      const { skillCommand } = await import('./cli-skill.ts')
      return skillCommand(argv)
    }
    case 'prefs': {
      const { prefsCommand } = await import('./cli-skill.ts')
      return prefsCommand(argv)
    }
    case 'service': return serviceCommand(args)
    case 'doctor': {
      const { doctor } = await import('./doctor.ts')
      return doctor(args.optOr('root', join(homedir(), '.c4-view'))) ? 0 : 1
    }
    default: return null
  }
}

/** Render or audit: print the report, write files on `render`, and decide the exit code. */
async function dispatch(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const early = argumentError(args)
  if (early !== null) return early
  const other = await otherCommand(args, argv)
  if (other !== null) return other
  if (!args.file) return 2
  const report = loadReport(args.file, args.opt('level'), args.opt('expand'))
  if (!report) return 2
  const model = loadModel(args.file)
  if (!model) return 2
  return reportCommand(
    {
      file: args.file,
      json: args.has('json'),
      strict: args.has('strict'),
      requireDocs: args.has('require-docs'),
      render: args.command === 'render',
      out: args.opt('out'),
      png: args.has('png'),
      scale: Math.max(1, Math.min(4, Number(args.optOr('scale', '2')) || 2)),
    },
    report,
    model,
  )
}

// Only the real binary exits the process; importing this module (the tests) must not.
/* node:coverage disable */
// Damage-free guard: when this file is imported, argv[1] is the test runner, so it never runs there.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  /* node:coverage enable */
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    },
  )
}

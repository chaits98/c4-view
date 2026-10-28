#!/usr/bin/env node
/**
 * `c4v` — the agent-facing door.
 *
 *   c4v render <model.json> [--level <path>] [--out <dir|file.svg>] [--png] [--scale <n>] [--strict]
 *   c4v audit  <model.json> [--json] [--strict]
 *   c4v serve  [--port 8788] [--root ~/.c4-view] [--host 127.0.0.1]
 *
 * `--strict` exits 1 when any geometry gate fails, so a skill can make "deliver
 * only a clean diagram" mechanical instead of a promise.
 *
 * `run(args)` is exported and returns the exit code, so the command line itself is under
 * test (`test/cli.test.ts`) instead of being the one part nobody could cover.
 *
 * @module c4-view/cli
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderFile, type Rendered, type RenderedLevel } from './render.ts'
import { svgToPng } from './png.ts'
import { auditLine } from './audit.ts'
import { ModelError } from './model.ts'
import { levelSlug } from './slug.ts'

const USAGE = `c4v — agent-driven C4 renderer

  c4v render <model.json> [--level <path>] [--out <dir|file.svg>] [--png] [--scale <n>] [--strict]
  c4v audit  <model.json> [--json] [--strict]
  c4v serve  [--port 8788] [--root ~/.c4-view] [--host 127.0.0.1]

  --level   render one level by path (root is "")           [default: every level]
  --out     a directory, or a .svg file when one level is rendered [default: ./out/<id>]
  --png     also write a PNG beside each SVG (--scale, default 2)
  --strict  exit 1 when any geometry gate fails (node∧node, wire∧node, wire∧wire, chip∧chip,
            chip∧node, group∧node)
`

/** The parsed command line: one object, so nothing has to reach for `process.argv`. */
interface Args {
  command: string | undefined
  file: string | undefined
  has: (name: string) => boolean
  opt: (name: string) => string | undefined
  optOr: (name: string, fallback: string) => string
}

function parse(argv: string[]): Args {
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i > 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? String(argv[i + 1]) : undefined
  }
  return {
    command: argv[0],
    file: argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined,
    has: (name) => argv.includes(`--${name}`),
    opt,
    optOr: (name, fallback) => opt(name) ?? fallback,
  }
}

/** `'' -> root`, `a/b -> a~b`: a file-safe, injective stem for one level. */
export { levelSlug as slugOf } from './slug.ts'

/** Where one level's file goes: the named .svg, or `<dir>/<level-slug>.svg`. */
function outputPath(out: string | undefined, id: string, level: string): string {
  if (out !== undefined && extname(out) === '.svg') return isAbsolute(out) ? out : resolve(out)
  return join(out ?? join('out', id), `${levelSlug(level)}.svg`)
}

function writeLevels(report: Rendered, out: string | undefined, png: boolean, scale: number): string[] {
  const written: string[] = []
  for (const level of report.levels) {
    const target = outputPath(out, report.id, level.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, level.svg)
    written.push(target)
    if (png) written.push(svgToPng(level.svg, target.replace(/\.svg$/, '.png'), scale))
  }
  return written
}

function printAudit(levels: RenderedLevel[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(levels.map((l) => l.audit), null, 2))
    return
  }
  for (const level of levels) console.log(auditLine(level.audit))
}

/** The serve command owns the process: it resolves only when the server is asked to stop. */
async function serveCommand(args: Args): Promise<number> {
  const { serve } = await import('./server.ts')
  const port = Number(args.optOr('port', '8788'))
  const root = args.optOr('root', join(homedir(), '.c4-view'))
  const host = args.optOr('host', '127.0.0.1')
  const srv = await serve({ port, root, host })
  const addr = srv.address()
  const shown = typeof addr === 'object' && addr !== null ? `${host}:${addr.port}` : `${host}:${port}`
  console.log(`c4v serving http://${shown} — diagrams in ${root}`)
  const stop = (): void => {
    srv.close(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return await new Promise<number>(() => {})
}

/** Render the model, or print why it could not be read. */
function loadReport(file: string, level: string | undefined): Rendered | null {
  try {
    return renderFile(file, level)
  } catch (error) {
    if (error instanceof ModelError) console.error(error.message)
    else console.error(error instanceof Error ? error.message : String(error))
    return null
  }
}

function writeOutputs(args: Args, report: Rendered): void {
  const scale = Math.max(1, Math.min(4, Number(args.optOr('scale', '2')) || 2))
  for (const path of writeLevels(report, args.opt('out'), args.has('png'), scale)) console.log(`wrote ${path}`)
}

/** Argument errors are answered before any work is done. */
function argumentError(args: Args): number | null {
  if (!args.command || args.command === 'help' || args.has('help') || args.command === '--help') {
    console.log(USAGE)
    return 0
  }
  if (args.command === 'serve') return null
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

/** Run the command line and resolve its exit code. Never calls process.exit. */
export async function run(argv: string[]): Promise<number> {
  const args = parse(argv)
  const early = argumentError(args)
  if (early !== null) return early
  if (args.command === 'serve') return serveCommand(args)

  const report = args.file ? loadReport(args.file, args.opt('level')) : null
  if (!report) return 2

  const failed = report.levels.filter((l) => !l.audit.ok)
  printAudit(report.levels, args.has('json'))
  if (args.command === 'render') writeOutputs(args, report)
  if (args.has('strict') && failed.length) {
    console.error(`\n${failed.length}/${report.levels.length} level(s) failed the geometry gate — fix the model, not the picture`)
    return 1
  }
  return 0
}

// Only the real binary exits the process; importing this module (the tests) must not.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    },
  )
}

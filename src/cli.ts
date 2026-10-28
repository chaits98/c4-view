#!/usr/bin/env node
/**
 * `c4v` — the agent-facing door.
 *
 *   c4v render <model.json> [--level <path>] [--out <dir|file.svg>] [--png] [--scale <n>] [--strict]
 *   c4v audit  <model.json> [--json] [--strict]
 *   c4v serve  [--port 8788] [--root ~/.c4-view]
 *
 * `--strict` exits 1 when any geometry gate fails, so a skill can make "deliver
 * only a clean diagram" mechanical instead of a promise.
 *
 * @module c4-view/cli
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { renderFile, type Rendered, type RenderedLevel } from './render.ts'
import { svgToPng } from './png.ts'
import { auditLine } from './audit.ts'
import { ModelError } from './model.ts'

const USAGE = `c4v — agent-driven C4 renderer

  c4v render <model.json> [--level <path>] [--out <dir|file.svg>] [--png] [--scale <n>] [--strict]
  c4v audit  <model.json> [--json] [--strict]
  c4v serve  [--port 8788] [--root ~/.c4-view] [--host 127.0.0.1]

  --level   render one level by path (root is "")           [default: every level]
  --out     a directory, or a .svg file when one level is rendered [default: ./out/<id>]
  --png     also write a PNG beside each SVG (--scale, default 2)
  --strict  exit 1 when any geometry gate fails (node∧node, wire∧node, wire∧wire, chip∧chip, chip∧node)
`

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (name: string): boolean => argv.includes(`--${name}`)
const opt = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i > 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? String(argv[i + 1]) : fallback
}
/** The model path is the first argument after the command. */
const fileArg = (): string | undefined => (argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined)

/** `'' -> root`, `a/b -> a-b`: a file-safe stem for one level. */
export function slugOf(path: string): string {
  return path === '' ? 'root' : path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function writeLevels(report: Rendered, out: string | undefined, png: boolean, scale: number): string[] {
  const written: string[] = []
  const single = report.levels.length === 1
  const outIsFile = out !== undefined && extname(out) === '.svg'
  if (outIsFile && !single) throw new Error('--out <file.svg> needs --level (one level per file)')

  for (const level of report.levels) {
    const target = outIsFile
      ? (isAbsolute(out as string) ? (out as string) : resolve(out as string))
      : join(out ?? join('out', report.id), `${slugOf(level.path)}.svg`)
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

async function main(): Promise<number> {
  if (!cmd || cmd === 'help' || flag('help') || cmd === '--help') {
    console.log(USAGE)
    return 0
  }
  if (cmd === 'serve') {
    const { serve } = await import('./server.ts')
    const port = Number(opt('port', '8788'))
    const root = opt('root', join(homedir(), '.c4-view')) as string
    const host = opt('host', '127.0.0.1') as string
    const srv = await serve({ port, root, host })
    const addr = srv.address()
    const shown = typeof addr === 'object' && addr !== null ? `${host}:${addr.port}` : `${host}:${port}`
    console.log(`c4v serving http://${shown} — diagrams in ${root}`)
    // the listening server IS the process: resolving here makes main() exit and kills it
    const stop = (): void => {
      srv.close(() => process.exit(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    return await new Promise<number>(() => {})
  }

  const file = fileArg()
  if (!file) {
    console.error(`missing <model.json>\n\n${USAGE}`)
    return 2
  }
  if (cmd !== 'render' && cmd !== 'audit') {
    console.error(`unknown command "${cmd}"\n\n${USAGE}`)
    return 2
  }

  let report: Rendered
  try {
    report = renderFile(file, opt('level'))
  } catch (error) {
    if (error instanceof ModelError) {
      console.error(error.message)
      return 2
    }
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const failed = report.levels.filter((l) => !l.audit.ok)
  printAudit(report.levels, flag('json'))
  if (cmd === 'render') {
    const scale = Math.max(1, Math.min(4, Number(opt('scale', '2')) || 2))
    const written = writeLevels(report, opt('out'), flag('png'), scale)
    for (const path of written) console.log(`wrote ${path}`)
  }
  if (flag('strict') && failed.length) {
    console.error(`\n${failed.length}/${report.levels.length} level(s) failed the geometry gate — fix the model, not the picture`)
    return 1
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  },
)

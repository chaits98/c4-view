/**
 * Writing and reporting — the part of the CLI that talks to a human or a filesystem.
 *
 * Split out of `cli.ts` when the lens report pushed that file past the 300-line ceiling; the split
 * follows the seam that was already there (everything here writes a file or a line, nothing here
 * parses an argument).
 *
 * @module c4-view/cli-output
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, dirname, join, resolve } from 'node:path'
import { levelSlug } from './slug.ts'
import { auditLine } from './audit.ts'
import { svgToPng } from './png.ts'
import type { LensReport } from './lens.ts'
import type { Rendered, RenderedLevel } from './render.ts'
import type { Model } from './types.ts'
import { docsDir, docsProblems } from './docs.ts'

/** Where one level's file goes: the named .svg, or `<dir>/<level-slug>.svg`. */
export function outputPath(out: string | undefined, id: string, level: string): string {
  if (out !== undefined && extname(out) === '.svg') return isAbsolute(out) ? out : resolve(out)
  return join(out ?? join('out', id), `${levelSlug(level)}.svg`)
}

export function writeLevels(report: Rendered, out: string | undefined, png: boolean, scale: number): string[] {
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

/** `--out` + `--png` + `--scale`: write the files and name them, in that order. */
export function writeOutputs(scale: number, out: string | undefined, png: boolean, report: Rendered): string[] {
  const written = writeLevels(report, out, png, scale)
  for (const path of written) console.log(`wrote ${path}`)
  return written
}

export function printAudit(levels: RenderedLevel[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(levels.map((l) => l.audit), null, 2))
    return
  }
  for (const level of levels) console.log(auditLine(level.audit))
}

/**
 * Lens problems fail the audit. `--json` keeps its array of per-level reports, so a consumer that
 * parsed it yesterday still parses it now; the exit code is the verdict either way.
 */
export function printLens(lens: LensReport, asJson: boolean): void {
  if (asJson) return
  for (const problem of lens.problems) console.error(`LENS FAIL ${problem}`)
}

/**
 * `--require-docs`: every node and edge of every level needs a doc. Presence and non-emptiness are all
 * this can check; the words themselves are a reviewer's job.
 */
function docsVerdict(flags: ReportArgs, model: Model): number {
  if (!flags.requireDocs || !flags.file) return 0
  const problems = docsProblems(docsDir(flags.file, model), model)
  const label = `docs: ${problems.length} node/edge doc(s) missing or empty`
  if (!problems.length) return 0
  for (const problem of problems.slice(0, 20)) console.error(`DOCS ${problem.where}: ${problem.path}`)
  if (problems.length > 20) console.error(`DOCS … and ${problems.length - 20} more`)
  console.error(`\n${label}`)
  return problems.length
}

export interface ReportArgs {
  file?: string
  json: boolean
  strict: boolean
  requireDocs: boolean
  render: boolean
  out?: string
  png: boolean
  scale: number
}

/** Print the report, write files on `render`, and decide the exit code. */
export function reportCommand(args: ReportArgs, report: Rendered, model: Model): number {
  const failed = report.levels.filter((l) => !l.audit.ok)
  printAudit(report.levels, args.json)
  printLens(report.lens, args.json)
  if (args.render) writeOutputs(args.scale, args.out, args.png, report)
  const docsMissing = docsVerdict(args, model)
  if (!args.strict) return 0
  if (failed.length) {
    console.error(`\n${failed.length}/${report.levels.length} level(s) failed the geometry gate — fix the model, not the picture`)
  }
  if (report.lens.problems.length) {
    console.error(`\n${report.lens.problems.length} lens problem(s) — a drill level must be the inside of one box; fix the ports, not the drawing`)
  }
  return failed.length || report.lens.problems.length || docsMissing ? 1 : 0
}

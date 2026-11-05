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
import { docsDir, docsProblems } from './docs.ts'
import { pictureAudits, renderExpanded, type Rendered } from './render.ts'
import type { AuditReport, Model } from './types.ts'

/** Where one level's file goes: the named .svg, or `<dir>/<level-slug>.svg`. */
export function outputPath(out: string | undefined, id: string, level: string): string {
  if (out !== undefined && extname(out) === '.svg') return isAbsolute(out) ? out : resolve(out)
  return join(out ?? join('out', id), `${levelSlug(level)}.svg`)
}

/**
 * Write the picture a reader opens, not a flatter one. A level with a child is SERVED composed (that is what
 * `/d/<id>/<path>` draws and what `audit` grades), so exporting the flat level beside a composed audit line
 * handed out a file nobody looks at — 15 crossings in the report, 7 in the SVG.
 */
export function writeLevels(model: Model, report: Rendered, out: string | undefined, png: boolean, scale: number): string[] {
  const written: string[] = []
  // one child means one composed picture: the level with that box opened in place, which is what `/d` draws.
  // Several children are several pages (`--expand <path>` writes one), so the level stays flat there.
  const onlyChild = (path: string): string | undefined => {
    const kids = model.levels.filter((l) => l.path !== path && l.path.startsWith(path ? `${path}/` : ''))
    return kids.length === 1 ? kids[0].path : undefined
  }
  for (const level of report.levels.map((l) => {
    const child = onlyChild(l.path)
    // the composed picture keeps the PARENT's path: that is the file this level has always written
    return child ? { ...renderExpanded(model, child).levels[0], path: l.path } : l
  })) {
    const target = outputPath(out, report.id, level.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, level.svg)
    written.push(target)
    if (png) written.push(svgToPng(level.svg, target.replace(/\.svg$/, '.png'), scale))
  }
  return written
}

/** `--out` + `--png` + `--scale`: write the files and name them, in that order. */
export function writeOutputs(scale: number, out: string | undefined, png: boolean, report: Rendered, model: Model): string[] {
  const written = writeLevels(model, report, out, png, scale)
  for (const path of written) console.log(`wrote ${path}`)
  return written
}

export function printAudit(audits: AuditReport[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(audits, null, 2))
    return
  }
  for (const audit of audits) console.log(auditLine(audit))
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
  /** audit the authored levels instead of the composed pictures a reader opens */
  flat: boolean
  /** geometry only: skip the modelling checks (lens problems), for corpus fixtures */
  noLens: boolean
  render: boolean
  out?: string
  png: boolean
  scale: number
}

/**
 * Why the pictures failed, in the reader's words. A box that never declared what it is has nothing to do
 * with geometry, and a message that says "geometry" sends them to nudge coordinates already correct.
 */
export function failureReasons(failed: AuditReport[]): string {
  let state = 0
  for (const a of failed) {
    const unbuilt = a.unbuilt?.length ?? 0
    const unstated = a.unstated?.length ?? 0
    if (unbuilt > 0 || unstated > 0) state += 1
  }
  const parts: string[] = []
  const geometry = failed.length - state
  if (geometry > 0) parts.push(`${geometry} on geometry`)
  if (state > 0) parts.push(`${state} on declared state`)
  return parts.join(', ')
}

/** Print the report, write files on `render`, and decide the exit code. */
export function reportCommand(args: ReportArgs, report: Rendered, model: Model): number {
  const audits = args.flat ? report.levels.map((l) => l.audit) : pictureAudits(model)
  const failed = audits.filter((a) => !a.ok)
  printAudit(audits, args.json)
  printLens(report.lens, args.json)
  if (args.render) writeOutputs(args.scale, args.out, args.png, report, model)
  const docsMissing = docsVerdict(args, model)
  if (!args.strict) return 0
  if (failed.length) {
    const where = args.flat ? 'level(s)' : 'picture(s)'
    console.error(`\n${failed.length}/${audits.length} ${where} failed the audit (${failureReasons(failed)}) — fix the model, not the picture`)
  }
  if (!args.noLens && report.lens.problems.length) {
    console.error(`\n${report.lens.problems.length} lens problem(s) — a drill level must be the inside of one box; fix the ports, not the drawing`)
  }
  const lensFails = args.noLens ? 0 : report.lens.problems.length
  return failed.length > 0 || lensFails > 0 || docsMissing > 0 ? 1 : 0
}

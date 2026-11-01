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
 * Lens problems fail the audit; warnings (a drill level that predates ports) only say so. `--json`
 * keeps its array of per-level reports, so a consumer that parsed it yesterday still parses it now;
 * the exit code is the verdict either way.
 */
export function printLens(lens: LensReport, asJson: boolean): void {
  if (!asJson) {
    for (const warning of lens.warnings) console.log(`LENS warn ${warning}`)
  }
  for (const problem of lens.problems) console.error(`LENS FAIL ${problem}`)
}

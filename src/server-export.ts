/**
 * The four ways a diagram leaves the viewer: an svg, a png, a page that needs no server, and every level
 * one after another. All of them are files, so all of them are named.
 *
 * @module c4-view/server-export
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { levelOf } from './model.ts'
import { nestedLevel } from './nest.ts'
import { renderModel } from './render.ts'
import { svgToPng } from './png.ts'
import { exportLayers, exportOne } from './export-page.ts'
import { LIGHT, exportPaletteOf } from './theme.ts'
import { levelSlug } from './slug.ts'
import { missing, noLevel, send } from './http-reply.ts'
import { loadModel, modelFile } from './store.ts'
import type { Theme } from './theme-choice.ts'
import type { Model } from './types.ts'

export type Format = 'svg' | 'png' | 'html' | 'layers'

/** A png for a picture that is not a level (the full view): cached under its own name. */
function pngOf(root: string, model: Model, svg: string, slug: string): string {
  const out = join(root, model.id, 'out', `${slug}.png`)
  const source = modelFile(root, model.id)
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(source).mtimeMs) return out
  return svgToPng(svg, out)
}

/** The file an export is saved as: the diagram, then what it shows. */
export function exportName(id: string, level: string, full: boolean): string {
  if (full) return `${id}-full`
  if (level === '') return id
  return `${id}-${levelSlug(level)}`
}

/** One cached png per level path — `levelSlug` is injective, so `a/b` and `a-b` never share. */
export function pngFor(root: string, model: Model, level: string, theme: Theme = 'dark'): string {
  // the scheme is part of the file: a light export must not be served the dark render that was cached first
  const palette = exportPaletteOf(theme)
  const out = join(root, model.id, 'out', `${levelSlug(level)}-${palette === LIGHT ? 'light' : 'dark'}.png`)
  const source = modelFile(root, model.id)
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(source).mtimeMs) return out
  return svgToPng(renderModel(model, level, palette, undefined, true).levels[0].svg, out)
}

/** Answer with the requested file. `?view=full` exports the whole model, not the level asked from. */
export function sendExport(root: string, req: IncomingMessage, res: ServerResponse, id: string, level: string, format: Format, theme: Theme): void {
  const model = loadModel(root, id)
  if (!model) return missing(req, res, id, theme)
  if (!levelOf(model, level)) return noLevel(req, res, level, model, theme)
  // coverage:invariant — node always sets req.url for an http request
  const full = new URL(req.url ?? '/', 'http://localhost').searchParams.get('view') === 'full'
  const name = exportName(model.id, level, full)
  if (format === 'html') return send(res, 200, 'text/html; charset=utf-8', exportOne(model, level, full, theme), `${name}.html`)
  if (format === 'layers') return send(res, 200, 'text/html; charset=utf-8', exportLayers(model, theme), `${model.id}-layers.html`)
  const palette = exportPaletteOf(theme)
  const scheme = palette === LIGHT ? 'light' : 'dark'
  if (format === 'png') {
    const file = full
      ? pngOf(root, model, nestedLevel(model, palette, true).svg, `full-${scheme}`)
      : pngFor(root, model, level, theme)
    return send(res, 200, 'image/png', readFileSync(file), `${name}.png`)
  }
  // an exported file carries its own canvas: no page CSS travels with an svg, so a dark drawing on a white
  // browser was unreadable — the second thing a reader noticed after the colours were right
  const svg = full ? nestedLevel(model, palette, true).svg : renderModel(model, level, palette, undefined, true).levels[0].svg
  send(res, 200, 'image/svg+xml; charset=utf-8', svg, `${name}.svg`)
}

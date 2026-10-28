/**
 * PNG export — the one place a browser is used.
 *
 * Headless Chromium screenshots a page that contains nothing but the emitted
 * SVG at its exact size, so the raster is a faithful capture of the vector we
 * already computed (no second layout engine, no second set of numbers).
 *
 * @module c4-view/png
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const CHROMIUM = process.env.C4_CHROMIUM ?? '/usr/bin/chromium'

/** The svg's own width/height attributes (the emitter always writes integers). */
function sizeOf(svg: string): { w: number; h: number } {
  const w = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(svg)
  const h = /<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/.exec(svg)
  if (!w || !h) throw new Error('png: the svg carries no width/height — the emitter must set both')
  return { w: Math.ceil(Number(w[1])), h: Math.ceil(Number(h[1])) }
}

/**
 * Rasterise an SVG string to `out` (a .png path). Returns the absolute path.
 * Throws with the exact missing path when Chromium is not installed.
 */
export function svgToPng(svg: string, out: string, scale = 2): string {
  if (!existsSync(CHROMIUM)) {
    throw new Error(`png: no chromium at ${CHROMIUM} (set C4_CHROMIUM to a chromium binary)`)
  }
  const target = resolve(out)
  mkdirSync(dirname(target), { recursive: true })
  const { w, h } = sizeOf(svg)
  const html = `${target}.html`
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#0a111b;overflow:hidden}</style>${svg}`,
  )

  execFileSync(
    CHROMIUM,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=' + String(scale),
      `--window-size=${w},${h}`,
      `--screenshot=${target}`,
      `file://${html}`,
    ],
    { stdio: 'pipe', timeout: 60_000 },
  )

  if (!existsSync(target)) throw new Error(`png: chromium wrote nothing to ${target}`)
  const bytes = statSync(target).size
  if (bytes < 1024) throw new Error(`png: ${target} is ${bytes} bytes — the capture is blank`)
  return target
}

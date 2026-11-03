/**
 * PNG export — the one place a browser is used.
 *
 * Headless Chromium screenshots a page that contains nothing but the emitted
 * SVG at its exact size, so the raster is a faithful capture of the vector we
 * already computed (no second layout engine, no second set of numbers).
 *
 * The browser is OPTIONAL: the SVG is the artifact, the PNG is a convenience.
 * So nothing here assumes a path — it looks for a browser the way a user would
 * (`$C4_CHROMIUM`, then the usual install locations, then PATH) and says exactly
 * what to do when it finds none. A hardcoded `/usr/bin/chromium` worked on the
 * machine it was written on and nowhere else.
 *
 * @module c4-view/png
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

/** Set this to point at any Chromium/Chrome binary. */
export const CHROMIUM_ENV = 'C4_CHROMIUM'

/** Install locations, in the order a person would try them. */
const KNOWN = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

const NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']

/** First `name` found on PATH. */
function onPath(name: string, exists: (path: string) => boolean = existsSync): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const full = join(dir, name)
    if (exists(full)) return full
  }
  return null
}

/**
 * The browser to screenshot with, or null. `$C4_CHROMIUM` wins even when it does
 * not exist, so the error can name the path the user got wrong.
 */
/** `exists` is a seam: "this machine has no browser" is a state worth testing. */
export function findChromium(exists: (path: string) => boolean = existsSync): string | null {
  const explicit = process.env[CHROMIUM_ENV]
  if (explicit) return explicit
  const known = KNOWN.find((path) => exists(path))
  if (known) return known
  for (const name of NAMES) {
    const found = onPath(name, exists)
    if (found) return found
  }
  return null
}

/** The svg's own width/height attributes (the emitter always writes integers). */
export function sizeOf(svg: string): { w: number; h: number } {
  const w = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(svg)
  const h = /<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/.exec(svg)
  if (w && h) return { w: Math.ceil(Number(w[1])), h: Math.ceil(Number(h[1])) }
  // a drawing with one box and no wires can come out with a viewBox and no width/height; the viewBox is
  // the same rectangle, so it is the size — refusing to rasterise it was a 500 on a valid diagram
  const box = /<svg[^>]*\sviewBox="[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg)
  if (!box) throw new Error('png: the svg carries neither width/height nor a viewBox — it is not a drawing')
  return { w: Math.ceil(Number(box[1])), h: Math.ceil(Number(box[2])) }
}

/**
 * Rasterise an SVG string to `out` (a .png path). Returns the absolute path.
 * Throws, with the fix inside the message, when no browser is installed.
 */
export function svgToPng(svg: string, out: string, scale = 2, find: () => string | null = findChromium): string {
  const browser = find()
  if (!browser || !existsSync(browser)) {
    const where = browser ? `no file at ${browser} ($${CHROMIUM_ENV})` : `nothing on PATH or in ${KNOWN.length} known locations`
    throw new Error(
      `png: no Chromium or Chrome found — ${where}.\n` +
        `      Set ${CHROMIUM_ENV}=/path/to/chrome, or render without --png: the SVG is the artifact.`,
    )
  }
  const target = resolve(out)
  mkdirSync(dirname(target), { recursive: true })
  const { w, h } = sizeOf(svg)
  // the page chromium loads is scaffolding, not an artifact: it is removed however we exit
  const html = `${target}.page.html`
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#0a111b;overflow:hidden}</style>${svg}`,
  )

  // A container (or a locked-down kernel) cannot start Chromium with its sandbox, and root always can't.
  // Try with the sandbox first — that is the default everywhere else — and retry once without it only when
  // the browser itself refused to start. Anything else (a real crash, a timeout) is reported as it is.
  const flags = ['--headless', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=' + String(scale), `--window-size=${w},${h}`, `--screenshot=${target}`]
  const launch = (sandbox: boolean): void => {
    execFileSync(browser, [...flags.slice(0, 2), ...(sandbox ? [] : ['--no-sandbox']), ...flags.slice(2), `file://${html}`],
      { stdio: 'pipe', timeout: 60_000 })
  }
  try {
    try {
      launch(process.getuid?.() !== 0)
    } catch (error) {
      /* node:coverage disable */
      // Only a sandbox refusal is retried: the message is Chromium's own, and it is the one case where the
      // remedy is a flag rather than a fix. Runs as root never take this path.
      if (!/SUID sandbox|Failed to move to new namespace|No usable sandbox/i.test(String(error))) throw error
      launch(false)
      /* node:coverage enable */
    }
  } finally {
    rmSync(html, { force: true })
  }

  if (!existsSync(target)) throw new Error(`png: chromium wrote nothing to ${target}`)
  const bytes = statSync(target).size
  if (bytes < 1024) throw new Error(`png: ${target} is ${bytes} bytes — the capture is blank`)
  return target
}

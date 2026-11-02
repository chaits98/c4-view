/**
 * Export pages — one self-contained HTML file, the svg already inside it.
 *
 * A viewer tab needs a server; a file a reader keeps does not. These pages carry their own CSS and their
 * drawings inline, so the only thing they need is a browser. No script, no fonts, no network.
 *
 * @module c4-view/export-page
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderModel } from './render.ts'
import { nestedLevel } from './nest.ts'
import { LIGHT, exportPaletteOf } from './theme.ts'
import type { Model } from './types.ts'

/**
 * The flow driver, inlined. A page a reader keeps should still narrate: the same module the viewer runs,
 * concatenated with its helper so the file has no imports — one script, no server, no basis to drift.
 */
function flowScript(): string {
  const dir = fileURLToPath(new URL('../public/', import.meta.url))
  const model = readFileSync(`${dir}flow-model.js`, 'utf8').replace(/^export /gm, '')
  const driver = readFileSync(`${dir}flow.js`, 'utf8').replace(/^import .*$/m, '')
  return model + '\n' + driver
}

const FLOW_CSS = `
#c4-stage{position:relative}
#c4-flow-caption{position:fixed;left:50%;bottom:12px;z-index:12;display:flex;align-items:center;gap:8px;
  max-width:min(70vw,720px);padding:4px 12px 4px 4px;background:var(--c4-bar);color:var(--c4-ink);
  border:1px solid rgba(128,128,128,.35);border-radius:9999px;box-shadow:0 6px 20px rgb(0 0 0 / .35);
  transform:translateX(-50%);font:13px/1.2 system-ui,sans-serif}
.c4-flow-btn{display:inline-flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;
  padding:0 12px;color:inherit;background:transparent;border:1px solid rgba(128,128,128,.35);
  border-radius:9999px;font:inherit;cursor:pointer}
.c4-flow-btn:hover{background:rgba(128,128,128,.16)}
.c4-flow-btn[aria-disabled='true']{opacity:.38;cursor:default}
#c4-flow-play{gap:4px;padding:0 16px;font-weight:600}
#c4-flow-text{margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.c4-dot{fill:#7cc4ff;stroke:#0a111b;stroke-width:2}
`

const FLOW_INK = `
body{--c4-bar:#211f26;--c4-ink:#e6e0e9}
body.light{--c4-bar:#f3edf7;--c4-ink:#1d1b20}
`

const CSS = `
:root{color-scheme:light dark}
body{margin:0;padding:24px;background:#0a111b;color:#e6edf6;
  font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body.light{background:#f7f9fc;color:#101828}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
h2{font-size:14px;font-weight:600;margin:32px 0 8px;opacity:.75}
p.sub{margin:0 0 24px;opacity:.6;font-size:12px}
svg{max-width:100%;height:auto;display:block}
figure{margin:0}
figcaption{margin-top:6px;font-size:12px;opacity:.6}
@media print{body{background:#fff;color:#000}h2{break-after:avoid}figure{break-inside:avoid}}
`

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** One svg, dropped inline. The svg is generated here, so it is trusted; the title is not. */
function figure(title: string, svg: string, stage = false): string {
  const body = stage ? `<div id="c4-stage">${svg}</div>` : svg
  return `<figure><figcaption>${esc(title)}</figcaption>${body}</figure>`
}

function shell(title: string, subtitle: string, body: string, light: boolean): string {
  const cls = light ? 'light' : ''
  // every exported page narrates: the driver ships inside it and finds the picture with a stage
  const script = `<script type="module">${flowScript()}</script>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title><style>${CSS}${FLOW_INK}${FLOW_CSS}</style></head>` +
    `<body class="${cls}"><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>${body}${script}</body></html>`
}

/** What the picture is of, in words: the whole model, the root, or one level. */
function scopeName(level: string, full: boolean): string {
  if (full) return 'every level'
  return level === '' ? 'overview' : level
}

/** The one picture the reader is looking at: a level, or the whole model opened up. */
export function exportOne(model: Model, level: string, full: boolean, choice = 'dark'): string {
  const palette = exportPaletteOf(choice)
  const drawn = full ? nestedLevel(model, palette, true) : renderModel(model, level, palette, undefined, true).levels[0]
  const title = `${model.title} — ${scopeName(level, full)}`
  return shell(title, `c4-view · ${model.id}`, figure(full ? 'Full diagram' : `Level ${level || '(root)'}`, drawn.svg, true), palette === LIGHT)
}

/**
 * Every level, one after another: the drill-in pictures, which is what "download all layers" means to a
 * reader who wants the parts, not the whole. The full diagram is `exportOne(..., true)` — a different ask.
 */
export function exportLayers(model: Model, choice = 'dark'): string {
  // "all layers" is the full diagram, not a stack of parts: the nested picture already holds every level,
  // and stacking the levels after it repeated the same boxes at different scales
  const palette = exportPaletteOf(choice)
  const pic = nestedLevel(model, palette, true)
  const body = `<h2>Full diagram</h2>${figure('every level', pic.svg, true)}`
  return shell(`${model.title} — all layers`, `c4-view · ${model.id} · ${model.levels.length} levels in one picture`, body, palette === LIGHT)
}

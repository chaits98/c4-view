/**
 * Export pages — one self-contained HTML file, the svg already inside it.
 *
 * A viewer tab needs a server; a file a reader keeps does not. These pages carry their own CSS and their
 * drawings inline, so the only thing they need is a browser. No script, no fonts, no network.
 *
 * @module c4-view/export-page
 */
import { renderModel } from './render.ts'
import { nestedLevel } from './nest.ts'
import { LIGHT, exportPaletteOf } from './theme.ts'
import type { Model } from './types.ts'

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
function figure(title: string, svg: string): string {
  return `<figure><figcaption>${esc(title)}</figcaption>${svg}</figure>`
}

function shell(title: string, subtitle: string, body: string, light: boolean): string {
  const cls = light ? 'light' : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title><style>${CSS}</style></head>` +
    `<body class="${cls}"><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>${body}</body></html>`
}

/** What the picture is of, in words: the whole model, the root, or one level. */
function scopeName(level: string, full: boolean): string {
  if (full) return 'every level'
  return level === '' ? 'overview' : level
}

/** The one picture the reader is looking at: a level, or the whole model opened up. */
export function exportOne(model: Model, level: string, full: boolean, choice = 'dark'): string {
  const palette = exportPaletteOf(choice)
  const drawn = full ? nestedLevel(model, palette) : renderModel(model, level).levels[0]
  const title = `${model.title} — ${scopeName(level, full)}`
  return shell(title, `c4-view · ${model.id}`, figure(full ? 'Full diagram' : `Level ${level || '(root)'}`, drawn.svg), palette === LIGHT)
}

/**
 * Every level, one after another: the drill-in pictures, which is what "download all layers" means to a
 * reader who wants the parts, not the whole. The full diagram is `exportOne(..., true)` — a different ask.
 */
export function exportLayers(model: Model, choice = 'dark'): string {
  const palette = exportPaletteOf(choice)
  const body = model.levels
    .map((level) => {
      const drawn = renderModel(model, level.path).levels[0]
      // the heading names the level, so the picture needs no second caption
      // coverage:invariant — parseModel gives every level a title (the root gets 'Overview')
      const label = level.path === '' ? '(root)' : level.path
      return `<h2>${esc(level.title ?? label)}</h2><figure>${drawn.svg}</figure>`
    })
    .join('')
  return shell(`${model.title} — all layers`, `c4-view · ${model.id} · ${model.levels.length} levels`, body, palette === LIGHT)
}

#!/usr/bin/env node
/**
 * Measure every colour pair the UI actually renders, from the shipped token file.
 *
 * WCAG 2.x relative luminance, sRGB, no dependency. Reads `public/tokens.css` so the
 * numbers cannot drift from the CSS: change a hex, run this, and a pair that dropped
 * under its threshold fails here instead of in someone's eyes.
 *
 *   node tools/contrast.mjs            # markdown table, exit 1 on any failure
 *
 * The diagram canvas is scheme-independent (visual-spec §8.1), so those rows are measured
 * once and reported in both columns as the same value.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DARK, LIGHT } from '../src/theme.ts'

const CSS = readFileSync(fileURLToPath(new URL('../public/tokens.css', import.meta.url)), 'utf8')

/**
 * `--name: light-dark(#light, #dark)` or a bare `--name: #hex` (a token that does not flip).
 * One form to read, because the sheet now declares each colour once.
 */
function tokens() {
  const out = new Map()
  const pair = /--([a-z0-9-]+)\s*:\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi
  const flat = /--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6});/gi
  for (const [, name, light, dark] of CSS.matchAll(pair)) out.set(name, { light, dark })
  for (const [, name, hex] of CSS.matchAll(flat)) if (!out.has(name)) out.set(name, { light: hex, dark: hex })
  return out
}

const all = tokens()

/** WCAG 2.x relative luminance of one hex colour. */
function luminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** label, foreground token, background token, WCAG threshold, what it is */
const PAIRS = [
  ['body text', 'on-surface', 'surface', 4.5, 'SC 1.4.3'],
  // the canvas: a drawing that cannot be read is not a drawing. 4.5 for text, 3 for strokes (1.4.11)
  ['canvas text', 'c4-fg', 'c4-bg', 4.5, 'SC 1.4.3'],
  ['canvas secondary', 'c4-dim', 'c4-bg', 4.5, 'SC 1.4.3'],
  ['canvas chip label', 'c4-chip-fg', 'c4-chip-bg', 4.5, 'SC 1.4.3'],
  ['canvas concept stroke', 'c4-concept-stroke', 'c4-bg', 3, 'SC 1.4.11'],
  ['canvas step stroke', 'c4-step-stroke', 'c4-bg', 3, 'SC 1.4.11'],
  ['canvas tool stroke', 'c4-tool-stroke', 'c4-bg', 3, 'SC 1.4.11'],
  ['canvas fact stroke', 'c4-fact-stroke', 'c4-bg', 3, 'SC 1.4.11'],
  ['canvas flow wire', 'c4-edge-flow', 'c4-bg', 3, 'SC 1.4.11'],
  ['canvas dep wire', 'c4-edge-dep', 'c4-bg', 3, 'SC 1.4.11'],
  ['secondary text', 'on-surface-variant', 'surface', 4.5, 'SC 1.4.3'],
  ['breadcrumb link', 'primary', 'surface', 4.5, 'SC 1.4.3'],
  ['button label on the bar', 'primary', 'surface-container', 4.5, 'SC 1.4.3'],
  ['selected chip', 'on-secondary-container', 'secondary-container', 4.5, 'SC 1.4.3'],
  ['audit pass badge', 'on-success-container', 'success-container', 4.5, 'SC 1.4.3'],
  ['audit fail badge', 'on-error-container', 'error-container', 4.5, 'SC 1.4.3'],
  ['control border', 'outline', 'surface', 3, 'SC 1.4.11'],
  ['focus ring', 'primary', 'surface', 3, 'SC 2.4.13'],
]

/** `rgba(r,g,b,a)` or `#hex` painted over an opaque colour: the drawing's let-through fills. */
function over(paint, base) {
  const rgba = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)[ ,/]+([\d.]+)?\)/i.exec(paint)
  if (!rgba) return paint
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4])
  const behind = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16))
  const mixed = [1, 2, 3].map((i) => Math.round(Number(rgba[i]) * alpha + behind[i - 1] * (1 - alpha)))
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** The drawing is not CSS: its colours come from src/theme.ts, one palette per scheme. */
const diagramPairs = (palette) => {
  const rows = []
  for (const [kind, spec] of Object.entries(palette.kinds)) {
    const fill = over(spec.fill, palette.bg)
    rows.push([`${kind} label on its fill`, palette.fg, fill, 4.5, 'SC 1.4.3'])
    rows.push([`${kind} identity line`, palette.dim, fill, 4.5, 'SC 1.4.3'])
    rows.push([`${kind} border on canvas`, spec.stroke, palette.bg, 3, 'SC 1.4.11'])
  }
  for (const [style, edge] of Object.entries(palette.edges)) {
    rows.push([`${style} edge on canvas`, edge.stroke, palette.bg, 3, 'SC 1.4.11'])
  }
  rows.push(['edge label chip', palette.chipFg, palette.chipBg, 4.5, 'SC 1.4.3'])
  rows.push(['group title on canvas', palette.dim, palette.bg, 4.5, 'SC 1.4.3'])
  return rows
}

let failed = 0
const rows = PAIRS.map(([label, fg, bg, need, criterion]) => {
  const measured = (scheme) => {
    const [a, b] = [all.get(fg)?.[scheme], all.get(bg)?.[scheme]]
    return a && b ? ratio(a, b) : NaN
  }
  const l = measured('light')
  const d = measured('dark')
  const ok = Number.isFinite(l) && l >= need && d >= need
  if (!ok) failed++
  return `| ${label} | \`${fg}\` on \`${bg}\` | ${l.toFixed(2)} | ${d.toFixed(2)} | ${need.toFixed(1)} | ${ok ? 'pass' : 'FAIL'} | ${criterion} |`
})

const drawRows = []
for (const [index, [label, fg, bg, need, criterion]] of diagramPairs(LIGHT).entries()) {
  const darkRow = diagramPairs(DARK)[index]
  const l = ratio(fg, bg)
  const d = ratio(darkRow[1], darkRow[2])
  const ok = l >= need && d >= need
  if (!ok) failed++
  drawRows.push(`| ${label} | theme.ts | ${l.toFixed(2)} | ${d.toFixed(2)} | ${need.toFixed(1)} | ${ok ? 'pass' : 'FAIL'} | ${criterion} |`)
}

console.log('| pair | tokens | light | dark | needs | result | criterion |')
console.log('|---|---|---|---|---|---|---|')
console.log([...rows, ...drawRows].join('\n'))
console.log(`\n${PAIRS.length + drawRows.length} pairs, ${failed} failing`)
process.exit(failed ? 1 : 0)

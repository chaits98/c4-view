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
  ['secondary text', 'on-surface-variant', 'surface', 4.5, 'SC 1.4.3'],
  ['breadcrumb link', 'primary', 'surface', 4.5, 'SC 1.4.3'],
  ['button label on the bar', 'primary', 'surface-container', 4.5, 'SC 1.4.3'],
  ['selected chip', 'on-secondary-container', 'secondary-container', 4.5, 'SC 1.4.3'],
  ['audit pass badge', 'on-secondary-container', 'secondary-container', 4.5, 'SC 1.4.3'],
  ['audit fail badge', 'on-error-container', 'error-container', 4.5, 'SC 1.4.3'],
  ['control border', 'outline', 'surface', 3, 'SC 1.4.11'],
  ['focus ring', 'primary', 'surface', 3, 'SC 2.4.13'],
  ['node text in the diagram', 'd-node-text', 'd-node-fill', 4.5, 'SC 1.4.3'],
  ['edge label on the canvas', 'd-edge-label', 'canvas', 4.5, 'SC 1.4.3'],
  ['edge line', 'd-edge', 'canvas', 3, 'SC 1.4.11'],
  ['active edge / flow dot', 'd-edge-active', 'canvas', 3, 'SC 1.4.11'],
]

/** The canvas rows cannot flip: their tokens are declared once. */
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

console.log('| pair | tokens | light | dark | needs | result | criterion |')
console.log('|---|---|---|---|---|---|---|')
console.log(rows.join('\n'))
console.log(`\n${PAIRS.length} pairs, ${failed} failing`)
process.exit(failed ? 1 : 0)

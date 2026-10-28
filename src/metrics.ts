/**
 * Text measurement without a font API.
 *
 * The SVG pins `font-family="DejaVu Sans"`; widths come from the advance table
 * generated out of the same TTF (`scripts/gen-metrics.py`), so the CLI, the
 * server and the browser all measure identically — and two runs of the same
 * model produce the same bytes.
 *
 * @module c4-view/metrics
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface MetricsFile {
  font: string
  unitsPerEm: number
  widths: Record<string, number>
  fallback: number
}

const HERE = dirname(fileURLToPath(import.meta.url))

export const FONT_FAMILY = 'DejaVu Sans, Inter, ui-sans-serif, system-ui, sans-serif'

const data = JSON.parse(readFileSync(join(HERE, '..', 'data', 'font-metrics.json'), 'utf8')) as MetricsFile

/** Advance width in px at `size`, 0.5px resolution (integer em table → halves). */
export function textWidth(text: string, size: number): number {
  let units = 0
  for (const ch of text) units += data.widths[ch] ?? data.fallback
  // one trailing half-space of visual breathing room, never counted twice
  return Math.round((units / 1000) * size * 2) / 2
}

/** Greedy word wrap at `maxWidth` px. A single over-long word is hard-split. */
export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const clean = text.trim()
  if (!clean) return ['']
  const lines: string[] = []
  let line = ''
  for (const word of clean.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (textWidth(next, size) <= maxWidth) {
      line = next
      continue
    }
    if (line) lines.push(line)
    if (textWidth(word, size) <= maxWidth) {
      line = word
    } else {
      // hard split a word that cannot fit at all — a box must never clip
      let piece = ''
      for (const ch of word) {
        if (textWidth(piece + ch, size) > maxWidth && piece) {
          lines.push(piece)
          piece = ch
        } else {
          piece += ch
        }
      }
      line = piece
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** The measure the layout receives — one object, no globals. */
export const measure = { width: textWidth, wrap: wrapText }

export const lineHeight = (size: number): number => Math.ceil(size * 1.35)

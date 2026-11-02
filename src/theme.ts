/**
 * The palettes. Colours are SVG attributes (no `<style>` block), so an exported file renders
 * identically in the app and outside it.
 *
 * `auto` used to render DARK, which meant a light-OS reader got a dark drawing on light chrome —
 * measured at 1.18:1, i.e. a ghost. `AUTO` answers that properly: every colour is a `var(--c4-*)`
 * that `tokens.css` declares once as a `light-dark()` pair, so the drawing follows the same scheme
 * the page does, with no request-time guess and no JavaScript. Exports still use a literal palette,
 * because a standalone SVG has no stylesheet to inherit.
 *
 * @module c4-view/theme
 */
import type { EdgeStyle, Kind } from './types.ts'

export interface Theme {
  bg: string; fg: string; dim: string; line: string
  chipBg: string; chipFg: string; groupStroke: string; groupFill: string
  kinds: Record<Kind, { fill: string; stroke: string }>
  edges: Record<EdgeStyle, { stroke: string; width: number; dash?: string }>
}

export const DARK: Theme = {
  bg: '#0a111b',
  fg: '#e6edf6',
  dim: '#8fa3b8',
  line: '#2a3a4f',
  chipBg: '#0f1a27',
  chipFg: '#cfe3f2',
  groupStroke: '#4a6f95',
  groupFill: 'rgba(40,70,105,.12)',
  kinds: {
    concept: { fill: 'rgba(139,92,246,.16)', stroke: '#8b5cf6' },
    step: { fill: 'rgba(59,130,246,.16)', stroke: '#3b82f6' },
    tool: { fill: 'rgba(45,212,191,.14)', stroke: '#2dd4bf' },
    fact: { fill: 'rgba(245,158,11,.14)', stroke: '#f59e0b' },
  },
  edges: {
    flow: { stroke: '#3b82f6', width: 1.6 },
    dep: { stroke: '#8fa3b8', width: 1.2, dash: '5 4' },
    tent: { stroke: '#f59e0b', width: 1.2, dash: '2 3' },
    dir: { stroke: '#e6edf6', width: 2 },
  },
}

/** The same diagram on a white document: darker strokes, faint kind tints. */
export const LIGHT: Theme = {
  bg: '#ffffff',
  fg: '#1d1b20',
  dim: '#49454f',
  line: '#cac4d0',
  chipBg: '#f3edf7',
  chipFg: '#1d1b20',
  groupStroke: '#94a3b8',
  groupFill: 'rgba(100,116,139,.08)',
  kinds: {
    concept: { fill: 'rgba(109,40,217,.07)', stroke: '#6d28d9' },
    step: { fill: 'rgba(29,78,216,.07)', stroke: '#1d4ed8' },
    tool: { fill: 'rgba(15,118,110,.07)', stroke: '#0f766e' },
    fact: { fill: 'rgba(180,83,9,.09)', stroke: '#b45309' },
  },
  edges: {
    flow: { stroke: '#1d4ed8', width: 1.6 },
    dep: { stroke: '#6b7280', width: 1.2, dash: '5 4' },
    tent: { stroke: '#b45309', width: 1.2, dash: '2 3' },
    dir: { stroke: '#1d1b20', width: 2 },
  },
}

/** The palette for a reader's choice; `auto` cannot be known here, so it is the dark one. */
/** Every colour in the drawing, as a token reference: the page decides the scheme, not the server. */
export const AUTO: Theme = {
  bg: 'var(--c4-bg)',
  fg: 'var(--c4-fg)',
  dim: 'var(--c4-dim)',
  line: 'var(--c4-line)',
  chipBg: 'var(--c4-chip-bg)',
  chipFg: 'var(--c4-chip-fg)',
  groupStroke: 'var(--c4-group-stroke)',
  groupFill: 'var(--c4-group-fill)',
  kinds: {
    concept: { fill: 'var(--c4-concept-fill)', stroke: 'var(--c4-concept-stroke)' },
    step: { fill: 'var(--c4-step-fill)', stroke: 'var(--c4-step-stroke)' },
    tool: { fill: 'var(--c4-tool-fill)', stroke: 'var(--c4-tool-stroke)' },
    fact: { fill: 'var(--c4-fact-fill)', stroke: 'var(--c4-fact-stroke)' },
  },
  edges: {
    flow: { stroke: 'var(--c4-edge-flow)', width: 1.6 },
    dep: { stroke: 'var(--c4-edge-dep)', width: 1.2, dash: '5 4' },
    tent: { stroke: 'var(--c4-edge-tent)', width: 1.2, dash: '2 3' },
    dir: { stroke: 'var(--c4-edge-dir)', width: 2 },
  },
}

/** A literal palette for files that leave the app: an export has no stylesheet to inherit. */
export function paletteOf(choice: string): Theme {
  if (choice === 'auto') return AUTO
  return choice === 'light' ? LIGHT : DARK
}

/** The palette an exported file gets: `auto` becomes the light document, since exports are viewed on paper or in a diff. */
export const exportPaletteOf = (choice: string): Theme => (choice === 'light' ? LIGHT : DARK)

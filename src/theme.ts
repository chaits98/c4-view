/**
 * The one palette. Colours are SVG attributes (no `<style>` block), so an
 * exported file renders identically in the app and outside it.
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
  groupStroke: '#33506e',
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

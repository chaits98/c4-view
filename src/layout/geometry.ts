/**
 * Shared geometry vocabulary for the router: the epsilon every comparison uses, the
 * corridor pad, the one rounding rule, and the item centres.
 *
 * @module c4-view/layout/geometry
 */
import type { PlacedItem } from '../types.ts'

export const EPS = 0.5
/** first corridor row sits this far below the drawing */
export const CORRIDOR_PAD = 18
/** Vertical space between two rows of columns: the corridor cross-row wires travel in. */
export const BAND_GAP = 56
/** separator inside a port key (`chain\u0001item\u0001side`) */
export const SEP = '\u0001'

export const round1 = (n: number): number => Math.round(n * 10) / 10

/** Deterministic string order. `localeCompare` is machine-dependent, so never use it here. */
export function compareKeys(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
export const centreY = (it: PlacedItem): number => it.y + it.h / 2
export const centreX = (it: PlacedItem): number => it.x + it.w / 2

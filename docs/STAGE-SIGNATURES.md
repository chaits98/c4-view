# Frozen stage signatures

Implement exactly these exports. Types come from `src/types.ts` (never edited by a stage owner).
`docs/LAYOUT-SPEC.md` is the normative algorithm; this file is the call contract.

```ts
// src/layout/rank.ts
export function rank(level: LevelSpec, cfg: LayoutConfig): Ranked

// src/layout/order.ts
export function order(ranked: Ranked, cfg: LayoutConfig): Ranked
/** inversions between adjacent ranks — used by order() and by tests */
export function countCrossings(ranked: Ranked): number

// src/layout/place.ts
export function measureNode(
  node: NodeSpec, cfg: LayoutConfig, m: Measure,
): { w: number; h: number; identity?: string; lines: string[]; tech?: string }
export function place(ranked: Ranked, level: LevelSpec, cfg: LayoutConfig, m: Measure): Placed

// src/layout/route.ts
export function route(placed: Placed, cfg: LayoutConfig, m: Measure): Routed

// src/layout/labels.ts
/** returns the same routes with `label` boxes filled in; never drops a label */
export function placeLabels(routes: Route[], placed: Placed, cfg: LayoutConfig, m: Measure): Route[]

// src/svg/shapes.ts
export type ShapeId =
  | 'rect' | 'rounded' | 'stadium' | 'subroutine' | 'cylinder' | 'circle'
  | 'diamond' | 'hexagon' | 'parallelogram' | 'trapezoid' | 'trapezoidAlt' | 'bars' | 'actor'
export function shapeOf(subtype: Subtype): ShapeId
/** the `d` attribute of the node's outline, in absolute coordinates */
export function shapePath(shape: ShapeId, box: Box): string

// src/theme.ts
export interface Theme {
  bg: string; fg: string; dim: string; line: string
  chipBg: string; chipFg: string; groupStroke: string; groupFill: string
  kinds: Record<Kind, { fill: string; stroke: string }>
  edges: Record<EdgeStyle, { stroke: string; width: number; dash?: string }>
}
export const DARK: Theme

// src/svg/emit.ts
export function emit(
  placed: Placed, routed: Routed, level: LevelSpec,
  cfg: LayoutConfig, theme: Theme, drill: Map<string, string>,
): string   // one self-contained <svg> element, no <style>, no external refs
```

## Rules every stage obeys

- Pure: no DOM, no `node:` imports, no `Date`, no `Math.random`, no logging.
- Never mutate an input object or map; return new ones.
- Deterministic: same input → same output. Iterate `Map`s in insertion order, never rely on object key order.
- Round only when a number leaves the stage (`Math.round(v * 10) / 10`); compute at full precision.
- ≤ 300 lines per file; split by responsibility, not by helper.
- Tests live in `test/<stage>.test.ts` and use `node:test` + `node:assert/strict`.

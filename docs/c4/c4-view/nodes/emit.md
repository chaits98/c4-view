# Emit

**C4V-26** · service-logic · `src/svg/emit.ts, shapes.ts`

Deterministic SVG: shapes, chips, the dashed lens frame, the drill links.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

The SVG carries no clock, no locale and no randomness: the same model renders byte-identically.

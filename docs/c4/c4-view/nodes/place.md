# Place

**C4V-24** · service-logic · `src/layout/place.ts`

Measures boxes, spaces columns by wire load, stacks rows, boxes up boundaries.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

A column's gap is set by its wire load and its widest chip, not by a constant.

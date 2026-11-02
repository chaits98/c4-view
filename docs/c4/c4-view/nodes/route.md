# Route

**C4V-25** · service-logic · `src/layout/route.ts`

Orthogonal wires in gutters, one track per jog, a corridor for the loops.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

One track per jog per gutter is what makes "no two wires share a collinear segment" hold by construction rather than by luck.

# Rank

**C4V-22** · service-logic · `src/layout/rank.ts`

Longest-path depth, one dummy per column a long edge crosses.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

A forward chain that spans more than one column gets one dummy per column, so routing has a corridor to travel instead of cutting across boxes.

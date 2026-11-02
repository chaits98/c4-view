# Order

**C4V-23** · service-logic · `src/layout/order.ts`

Six barycentre sweeps; the ordering with fewest inversions wins.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

Six sweeps, best-scoring kept. It cannot improve on a graph whose crossings are structural — measured: 60 permutations of one level changed nothing.

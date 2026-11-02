# Model parse

**C4V-21** · service-logic · `src/model.ts`

Validates the model: ids, subtypes, ranks, ports, direction. Refuses rather than guesses.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

It refuses a port that names a node the level does not have, a subtype it does not know, and a direction that is neither `auto`, `LR` nor `TB`.

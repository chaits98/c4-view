# Publish

**C4V-29** · service-logic · `src/cli-publish.ts, store.ts`

Copies a model and its docs into the store the server reads.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

It copies rather than links, so the store keeps working when the repo moves.

# Repo gate

**C4V-28** · service-logic · `src/gate.ts, cli-gate.ts`

install, check, defer, status, uninstall — the commit-time contract.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

It measures the commit, it does not judge the drawing: code changed without the model is the only thing it refuses.

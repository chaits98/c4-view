# Args + dispatch

**C4V-20** · service-logic · `src/cli.ts, cli-args.ts`

Reads the command line, refuses what cannot work, and calls one verb.

## Where it sits

A component inside the CLI process. The CLI is one-shot: every box here is a stage it passes through before it exits with a verdict. Shown on the **C3 · inside the c4v CLI** level.

## What to know

Which verbs need no model file, what `service` takes, and why `--out x.svg` needs `--level`.

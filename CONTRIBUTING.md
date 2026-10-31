# Contributing

The product is a layout engine and a grammar for architecture models. Contributions that keep both
simple are welcome; contributions that add knobs to work around a bad model are not.

## What you need

Node 22.18+ (the source runs as TypeScript; there is no build step for development). Docker is only
needed if you want PNG export, and `--png` needs a Chromium/Chrome binary — set `C4_CHROMIUM` if it is
not in a standard location.

```bash
git clone <repo> c4-view && cd c4-view
./scripts/setup-dev.sh    # node check, dev deps, dist build, hooks, scanner image, then proves it
```

`setup-dev.sh` is the only setup step, and it is idempotent. It sets `core.hooksPath` to `.githooks`, so
**the pipeline runs before you push, not after**: pre-commit takes ~10 s (gates, types, tests, goldens,
audit, secrets) and pre-push runs the full suite (adds the four skill scanners, SonarQube when a token is
present, `npm audit`, `doctor`). CI calls the same script, so a green push means a green pipeline.

## The one command that must pass

```bash
./scripts/check.sh          # --fast (default): gate, tsc, tests, goldens, audit, secrets — ~10 s
./scripts/check.sh --full   # + skill scanners, Sonar, npm audit, doctor — what pre-push and CI run
```

Behind it, so you know what is being enforced:

```bash
node tools/gate.mjs      # every file ≤ 300 lines, no `any`, no placeholders, core stays pure
npx tsc --noEmit         # strict
node --test              # the suite
node tools/golden.mjs --check   # 11 corpus levels must render byte-identically
node src/cli.ts audit fixtures/*.json examples/*.json docs/c4/*.json --strict   # (one file at a time)
```

`tools/golden.mjs --save` is allowed only when you can explain the diff. A change that moves goldens
without a one-line reason is a regression until proven otherwise.

## The rules that are actually enforced in review

1. **Fix the model, not the picture.** There are no coordinates to nudge. If a diagram looks wrong, the
   model is wrong — or the engine is, and then the engine gets the fix and a regression test.
2. **Non-overlap is structural.** Space for wires is allocated during layout. A change that re-routes or
   nudges after the fact will be rejected; that is the design this project exists to avoid.
3. **Determinism is a feature.** No `Date`, no `Math.random`, no `localeCompare`, no unordered
   iteration in output. The same model must produce the same bytes on every machine.
4. **300 lines per file, enforced by `tools/gate.mjs`.** Split by responsibility, not to satisfy a
   number: a 320-line file is telling you it has two jobs.
5. **Every gate is a gate.** Six overlap checks must be zero; `crossings`, `backward` and `aspect` are
   reported and explained, never silenced.
6. **Escaping at the boundary.** Anything from the model reaches SVG/HTML through the escaping helpers.
   A new output path needs an injection test.

## Commits

- Sign off (`git commit -s`) — this project uses the DCO, not a CLA.
- One logical change per commit, with a body that says *why*. If a commit changes a golden hash, it
  says which attribute changed and why the geometry did not.
- Agents are welcome as contributors. A commit written by an agent must say so, and must not be
  authored under a human's identity.

## Adding a level, a shape or a gate

- New C4 subtype: add it to `Kind`/`NOTATION` in `src/types.ts`, give it a shape in `src/svg/shapes.ts`
  with a text inset that keeps labels inside the silhouette, and add it to the fixture corpus.
- New gate: `src/audit.ts` gains one counter with a planted-defect test, and `ok` includes it. A gate
  that cannot fail on a real defect is not a gate.
- New CLI flag: it must appear in `USAGE`, in `docs/HTTP-API.md` if it touches the server, and in a test
  that asserts the exit code it produces.

## Reporting a modelling problem instead of code

Open an issue with the model attached and the audit line. "This level is unreadable" is a useful bug
report; `aspect` and `crossings` numbers make it actionable, and a reducer model helps more than a
screenshot.

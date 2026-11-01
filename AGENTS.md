# AGENTS.md

Everything a contributor — human or agent — needs to change this repo without breaking it. Read this before
the first edit; `README.md` explains what the product is, this file explains how to work in it.

## What you are working on

Two halves that ship together:

- **the CLI** (`src/`, `bin/`) — `c4v` turns a JSON C4 model into deterministic SVG/PNG and serves a
  read-only viewer. Zero runtime dependencies. Node ≥ 22.18.
- **the skill** (`skill/`) — what teaches an AI agent to use the CLI well. It is a product too: `SKILL.md` is
  read by models, so its wording is behaviour, not documentation.

## Ground truth commands

| command | what it does | when |
|---|---|---|
| `./scripts/setup-dev.sh` | makes a fresh machine able to contribute: node floor, deps, `dist/` build, `core.hooksPath`, scanner image, then proves it | once per machine |
| `./scripts/check.sh --fast` | gate, `tsc`, tests, goldens, audit, secrets — ~10 s | before **every** commit |
| `./scripts/check.sh --full` | `--fast` + 4 skill scanners, SonarQube, a **95 % coverage floor**, `npm audit`, doctor — ~2 min | before push / release |
| `./scripts/check.sh --list` | print the steps | when unsure what runs |
| `npm run doctor` | can this machine run the tool at all | after install |
| `npm run goldens` / `npm run goldens:update` | compare / deliberately re-baseline the 11 golden SVGs | after an intended geometry change |

Hooks are installed by `setup-dev.sh` (`core.hooksPath=.githooks`): pre-commit runs `--fast`, pre-push runs
`--full`, and CI runs the same script. **One script, three callers** — if a check exists only in CI, a
contributor finds out too late; if only in the hook, CI drifts from it.

Never commit with `--no-verify`. A hook slow enough to tempt you is a hook bug: fix the script, not the habit.

## The laws (the gate fails the build)

1. **≤ 300 lines per file** — `src/**/*.ts`, `test/**/*.ts`, `scripts/**/*.ts`, `public/*.js`, `tools/*.mjs`.
   Split by responsibility; never by "part 2".
2. **No `any`**, no placeholders, no TODOs in shipped code.
3. **Purity boundary** — `src/layout/*` and `src/svg/*` import nothing from `cli`/`server`/`render`/`png` and
   no `node:` builtins. Layout is a pure function of the model.
4. **No `console.*`** in library modules (`src/model.ts`, `src/audit.ts`, `src/metrics.ts`, layout, svg).
   Output goes through the CLI.
5. **Deterministic output** — no `Date`, no `Math.random`, no `localeCompare`, no locale-dependent sorting.
   Use `compareKeys`. The same model must render byte-identical SVG on every machine, forever.
6. **Zero runtime dependencies.** Dev dependencies are fine. If you think you need a runtime dep, you are
   about to break `npm i -g c4-view` on an air-gapped box.

## The work loop

1. **Read before writing.** The file you are about to change, its callers (`grep` them), and the doc that
   claims what it does (`docs/LAYOUT-SPEC.md` is normative for layout).
2. **Smallest diff that is correct.** Deletion beats addition. No abstraction with one implementation, no
   config for a value that never changes, no scaffolding for later.
3. **One check per non-trivial behaviour.** `node --test`; a bug fix gets a test that fails before it.
4. **`./scripts/check.sh --fast`** — do not proceed on red.
5. **Commit** on a feature branch (see below) with the `Unit:` trailer.
6. **Report what changed, what is verified, what is left.** Never end a turn on a promise of future work.

## Branches, commits, releases

- Work on `feat/<topic>`. `main` is the owner's to merge; a unit never lands itself. Merging to `main`
  needs his explicit go-ahead.
- Commit identity is `c4-view <c4-view@local>`. Never commit as the owner — the machine-wide git policy
  refuses it.
- Every commit ends with a trailer: `Unit: c4-view-build`.
- Commit messages say **why**, in the body, in plain sentences. The subject line is a summary, not a poem.
- Version = `package.json` `version`, mirrored by a `CHANGELOG.md` section and a `vX.Y.Z` tag. Features bump
  the minor; a breaking model change bumps the major **and** says so in the CHANGELOG.

## What proves what

| claim | the only acceptable evidence |
|---|---|
| "it renders" | `c4v audit <model> --strict` exit 0 with the gate lines pasted |
| "geometry did not drift" | `npm run goldens` — 11 levels byte-identical |
| "it still works" | `./scripts/check.sh --fast` all PASS |
| "it ships" | `--full` PASS, including Sonar's verdict, the four skill scanners and ≥95 % coverage |
| "the skill is good" | a graded run from `tools/matrix.sh`, never an opinion |
| "the diagram is right" | the rendered PNG, looked at — gates cannot see a wrong layer |

**Damage guards are excluded, by name and with a reason.** A branch that can only run when the
installation is broken (a missing package file, an old Node, a non-`Error` throw, a client that keeps
writing past a refusal, Chromium running as root, a gutter with 198 lanes) is annotated inline with
`/* node:coverage disable */ … /* node:coverage enable */` and a comment saying which state it covers.
Two rules keep this honest: the annotation states the damage it covers, and the damage must not be
simulatable — if a seam can simulate it (a bad path, an old version, no browser), write the seam and
test it instead. `git log -S'node:coverage disable'` lists every exclusion ever added.

**Coverage floor: 95 %, measured as Sonar measures it** — `(covered lines + covered branches) / (lines +
branches)` over `coverage/lcov.info`. Sonar's own gate on this instance is the built-in "Sonar way" (80 %),
which cannot be edited without admin rights; the floor lives in `check.sh` so the repo holds the higher bar
regardless. New code arrives with the tests that cover it — a branch added "for later" is a branch nobody
will ever exercise.

Unit tests do not prove integration: use `curl` against a running `c4v serve`, or the testbed.

**`c4v serve` reads `src/` at boot and `public/` per request.** A change under `src/` that the server has
not restarted for is not live, and a screenshot of it is a screenshot of the old code — this has made the
app look broken twice. Restart the process before you look at it, and say which build the screenshot is of.

## Grading the skill (only when `skill/` changed)

```bash
./tools/matrix.sh --model both --repeat 2 --tag <name>   # 3 repos × 2 models × N runs, graded on exit
node tools/grade.mjs --run <run-dir> --repo <checkout> --facts grading/<repo>.facts.json
node tools/grid.mjs --runs <runs-dir>
```

- Cells are comparable only if image, prompt, model and server state are identical — that is why the script
  exists. Hand-run cells produced a 14-point spread on one cell.
- **Fewer than ~5 points needs ≥3 runs per side.** Anything less is noise (see `docs/plans/GRID.md`).
- 10 of the 100 points are the **visual pass**: look at the rendered PNG and score into
  `grading/visual.json`. Never let a machine-only number stand in for it.
- The local model (Qwen 35B) cannot tell containers from modules — treat it as a smoke test, not a judge.

## Repo map

```
src/types.ts        the frozen contract every stage speaks
src/model.ts        validation, normalisation, drill paths
src/layout/         rank · order · place · route · labels · measure-node   (pure)
src/svg/            shapes · emit                                          (pure)
src/render.ts       the pipeline · src/cli.ts · src/server.ts · src/png.ts
src/{audit,flow,metrics}.ts   gates · narration order · text measurement
src/{doctor,service,security}.ts   diagnostics · systemd unit · token + CSP
src/prefs.ts, src/cli-skill.ts     preferences · `c4v skill|prefs`
public/             viewer.html · viewer.js · flow.js · viewer.css (no bundler, CSP-safe)
skill/              SKILL.md · assets/example.json · harnesses.jsonl · preferences.jsonl
test/               node:test, incl. the corpus and the audit's own defects
docs/               LAYOUT-SPEC (normative) · HTTP-API · security/ · plans/ · design/ · launch/
tools/              gate · golden · grade · grid · matrix.sh
fixtures/ examples/ gallery/      real and hand-authored models
```

## If you are editing `skill/`

The skill is prompt engineering with a test matrix attached. Rules learned the hard way:

- **Never name a path the agent cannot write.** A workspace-scoped harness denies `/tmp` and `~/.c4-view`;
  naming them makes the agent try, get rejected, and conclude the tool is broken. Scratch is
  `docs/c4/.scratch/`.
- **A failing audit is a hard stop**, and the text must say so — agents deliver partial work otherwise.
- **Mechanisms you can look up do not need prose.** 30% of the old skill was narrative that never changed an
  action; every cut was measured, not assumed.
- Changes need a graded batch. `skill/SMOKE-PROMPT.md` is the one-line prompt used for the matrix.

## Known ceilings (do not "fix" these without a plan)

- `direction: 'LR'` only; `TB` is rejected with a named error rather than drawn wrong.
- A pure chain renders as a long strip; a very wide level renders small text at fit-to-width — the parked
  pan/zoom feature addresses that, not the layout.
- `crossings` is reported, not gated: split the level or accept it consciously.
- `c4v service` is systemd-user only. macOS/Windows are refused, not half-implemented.

## Do not

- Hand-place geometry, nudge coordinates, or "fix" an SVG. If the picture is wrong, the model is wrong.
- Add a runtime dependency, a bundler, or a framework to the viewer.
- Edit `fixtures/` by hand — they are exported from the owner's real store (`npm run fixtures`).
- Copy files into `~/.c4-view`; the server owns that store (`POST /api/diagrams`).
- Commit secrets. `gitleaks` runs on every commit and over history.

## Where decisions live

- `CHANGELOG.md` — what shipped, per version, and why.
- `docs/plans/GRID.md` — the measured matrix, all rounds, variance rules.
- `docs/plans/RUNLOG.md` — what broke, how it was diagnosed.
- `docs/design/PARKED.md` — decided and not started. Move an item out when it starts.
- `docs/design/` — the UX guideline and Material 3 spec for the viewer UI.

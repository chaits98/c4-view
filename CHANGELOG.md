# Changelog

All notable changes. The **model format** and the CLI are versioned together: a breaking change to the
JSON model is a breaking change to this tool, and is called out as such.

## [0.4.0] — the viewer stops looking like 2023

### Added
- **Pan + zoom on the diagram page.** The canvas is a native scroll container and `?zoom=fit|0.5…3` is a
  class the server renders, so a shared link, a reload and Back all restore the reading size before the
  first paint, with JS off. `Fit / 100% / 200% / − / +` in the header. Measured at 1280: a 3016 px level
  draws its 12 px labels at 12 px at `100%` (was 5 px at fit).
- **Honest cards.** A drawing wider than 3:1 is cropped to the middle with edge fades instead of squeezed
  into a smear, and the countable facts (`3 levels · 6 nodes · 5 flows`) are text. Same card measured
  before/after: labels 5 px → 11 px at the cost of showing 48 % of the width, declared by the crop.
- **A flow-control contract.** Paused on step 1 at first paint, caption `{from} → {to} · {label} · {n} /
  {total}` in node labels, keys scoped to the bar, `aria-live` off while playing and polite when stepping,
  Replay at the end, no loop. The rules live in `public/flow-model.js` and are held by `node --test`.
- **`public/tokens.css`** — the Material 3 baseline as one `light-dark()` pair per colour, plus a semantic
  green for the audit-pass chip (M3 ships no success role). `tools/contrast.mjs` measures 27 pairs and runs
  in `--fast`.
- **A colour-scheme control** on the grid: `Auto · Light · Dark` as links, remembered in a cookie and
  rendered as `data-theme`. The diagram canvas follows it — the server draws `LIGHT` or `DARK` from
  `src/theme.ts`, because SVG colours are attributes and cannot answer a media query.

### Fixed
- A node's text could render outside its own silhouette: an actor's last line sat 7.8 px below the shape,
  a cylinder wrote its id across the top ellipse, and `bars` left 13.6 px gaps that a three-line label fell
  into (queues and jobs now draw as a `subroutine`). The silhouette declares its text band and
  `measureNode` grows the box to fit it; `test/emit.test.ts` asserts that for every subtype. Goldens were
  re-baselined deliberately (11 levels, geometry change).
- `check.sh --full` claimed `PASS sonar` while the quality gate was red: the scanner exits 0 once the
  analysis is *uploaded*, and nobody read the verdict. The step now queries the gate API and fails on it.
  With that in place: two unreviewed `S4036` hotspots in `src/service.ts` (systemctl resolved through PATH
  — it is now an absolute path) and four `viewer-page.ts` smells were fixed. Open issues: 0.

- `docs/design/README.md` — the measured contrast table (27 pairs) and how the scheme is decided, so the
  design docs and the shipped tokens cannot drift apart.

### Changed
- SKILL.md 5,154 → 3,617 tokens (-30%) with the rules intact. Measured, not assumed: four runs of the
  same cell (express × OpenCode × local Qwen) scored 84 / 76 / 76 / 70 — the 70 on the *long* skill — so
  the difference between the two texts is inside this model's run-to-run noise (±7 on 90). The shorter one
  is kept because it costs less per call, not because it scored better; a single cell cannot prove either.

### Removed
- Build scaffolding that shipped with the first cut: `WORKBOOK.md`, `tools/wb.mjs`, `workbook/`,
  `docs/STAGE-SIGNATURES.md`, and a viewer probe that hung. They were how this was built, not what it is.
- Committed PNGs under `gallery/` — regenerable from the models beside them (`c4v render <model> --png`).

## [0.3.0] — the skill goes everywhere, and stops guessing

### Added
- `c4v skill install | list` — one JSONL registry (`skill/harnesses.jsonl`, 14 harnesses) decides where the
  skill goes; `--global` installs into every harness detected on the machine, `--harness id,id` names them.
  Adding a harness is one line.
- `c4v prefs pending | show | set | greeting` — questions asked once, stored in `~/.c4-view/prefs.json`.
  A release that adds a question makes it pending for existing users; they are asked only that.
- `tools/matrix.sh` — one image, one prompt, sequential runs, graded on exit; `--model local|deepseek`,
  `--repeat N`, `--tag`. Four rounds of twelve cells are recorded in `docs/plans/GRID.md`.
- `docs/design/` — the viewer's UX guideline, Material 3 light/dark token set, and `PARKED.md`.
- Grading now covers 100 points: 90 machine-checked plus a 10-point visual pass recorded in
  `grading/visual.json`. Latest: **deepseek 95.8/100, local 83.6/100**, gates 20/20 and delivery 5/5.

### Changed
- SKILL.md 5,154 → 3,880 tokens with the rules intact, after four measured rounds rather than by taste.
- Three rules the rounds forced: a level that prints `FAIL` is a hard stop; every path you write stays inside
  the repo (a denied `/tmp` write looked like a broken tool and ended runs); and the small seams that keep
  being dropped are named (HTTP server, test client, static serving, proxy trust, query parser, content
  negotiation, middleware chain).
- The skill never sends an agent into `~/.c4-view` — a workspace-scoped harness denies it — and a rejected
  `prefs` call must never end the run. Scratch is `docs/c4/.scratch/`; the tool's own scratch is
  `~/.c4-view/scratch/`.

## [0.2.2] — the first shippable cut

### Added
- `schema.json` — JSON Schema for the model, validated against every fixture in the suite.
- `c4v service install | uninstall | status` — the viewer as a systemd **user** unit, so it survives the
  shell that started it. Linux only, by design.
- `scripts/check.sh` — the one pipeline: `--fast` for pre-commit (~10 s), `--full` for pre-push and CI
  (adds four skill scanners, SonarQube, `npm audit`, `doctor`). Hooks live in `.githooks`.
- `scripts/setup-dev.sh` — one idempotent command that makes a fresh machine able to contribute without
  drifting: node floor, deps, build, `core.hooksPath`, scanner image, then proves it.
- Security: a bearer token is **required** on any non-loopback bind (generated when absent), accepted as
  header, `?t=` or `HttpOnly; SameSite=Strict` cookie; CSP, `nosniff`, `no-referrer`, `X-Frame-Options` on
  every response; `--no-sandbox` is passed to Chromium only when running as root.
- `docs/security/REPORT.md` — four keyless skill scanners (SkillSpector, cisco, agentscan, skillfrisk) plus
  Semgrep, gitleaks and Sonar; `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`,
  issue/PR templates, and a two-job CI workflow.
- `docs/plans/{GRID,RUNLOG,DISTRIBUTION,RELEASE-TEST-PLAN}.md` — the measured matrix (3 repos × 3 harnesses
  × 2 models), the harness matrix log, and the distribution proof (install, upgrade, tamper, uninstall).

### Fixed
- `--png` without a browser threw an unhandled rejection with a stack inside `node_modules`; it is one
  message and exit 1.
- `private: true` made the package unpublishable.
- Reinstalling the systemd unit over a running service did not restart it, so the new code never loaded.
- `run()` cannot re-rank a level whose hint collides with an edge, and the audit now reports `backward=N`
  so an unintended loop is visible instead of silent.

### Changed
- The skill's Commands block names `c4v` only: the old `node src/cli.ts` path taught an agent on a
  installed system to conclude the tool was missing.
- A box is a container only if it could be deployed, restarted or scaled alone; the skill now decides
  "system or library" before planning levels.

## [0.2.1] — installable anywhere

### Fixed
- `--png` without a browser threw an unhandled rejection with a stack pointing into `node_modules`;
  it is now one message and exit 1.
- `private: true` made the package unpublishable.

### Added
- `c4v doctor` — node floor, viewer assets, font table, writable store, optional browser.

## [0.2.0] — shippable

### Added
- `dist/` build, launcher that prefers it, `$C4_CHROMIUM` discovery, engine floor in `package.json`.
- Audited geometry: six gates, plus `crossings`, `backward` and `aspect` reported per level.

## [0.1.0] — first render

- Deterministic layout (rank → order → place → route → labels → emit), SVG/PNG, read-only viewer with a
  linear data-flow animation, and the index grid.

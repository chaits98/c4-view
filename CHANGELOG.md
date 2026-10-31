# Changelog

All notable changes. The **model format** and the CLI are versioned together: a breaking change to the
JSON model is a breaking change to this tool, and is called out as such.

## [Unreleased]

### Added
- Design research for the viewer UI (UX guideline + Material 3 light/dark token set) in `docs/design/`.
  **Not implemented**; it lands as its own feature.
- `docs/design/PARKED.md` — every feature we decided on and have not started (viewer UI, single-file HTML
  export, grid sort/filter, portrait layout, macOS/Windows service, public release), each with what it
  takes to start.

### Changed
- SKILL.md 5,154 → 3,617 tokens (-30%) with the rules intact. Measured, not assumed: four runs of the
  same cell (express × OpenCode × local Qwen) scored 84 / 76 / 76 / 70 — the 70 on the *long* skill — so
  the difference between the two texts is inside this model's run-to-run noise (±7 on 90). The shorter one
  is kept because it costs less per call, not because it scored better; a single cell cannot prove either.

### Removed
- Build scaffolding that shipped with the first cut: `WORKBOOK.md`, `tools/wb.mjs`, `workbook/`,
  `docs/STAGE-SIGNATURES.md`, and a viewer probe that hung. They were how this was built, not what it is.
- Committed PNGs under `gallery/` — regenerable from the models beside them (`c4v render <model> --png`).

## [0.2.2] — the first shippable cut

### Added
- `schema.json` — JSON Schema for the model, validated against every fixture in the suite.
- `c4v skill install | list` — one JSONL registry (`skill/harnesses.jsonl`, 14 harnesses) decides where the
  skill goes; `--global` installs into every harness detected on the machine, `--harness id,id` names them.
  Adding a harness is one line.
- `c4v prefs pending | show | set | greeting` — questions asked once, stored in `~/.c4-view/prefs.json`.
  A release that adds a question makes it pending for existing users; they are asked only that.
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

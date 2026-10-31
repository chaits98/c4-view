# Skill card — c4-diagram

The human-readable half of the trust story: what this skill does, what it is allowed to touch, and where it
stops. (NVIDIA's pipeline asks for exactly this shape; a scanner says "safe to load", a card says "this is
what it will do".)

| | |
|---|---|
| **name** | `c4-diagram` |
| **version** | 0.2.2 — versioned with the tool it drives |
| **licence** | MIT (`LICENSE` in this directory) |
| **owner** | the c4-view maintainer (see `GOVERNANCE.md`) |
| **what it does** | turns "build a C4 of this repo" into a gated JSON model, deterministic SVG/PNG, and a viewer link |
| **what it does NOT do** | no editing UI, no network access, no telemetry, no file writes outside the repo, no C4 "code level" unless asked |
| **trigger** | a request to produce or update an architecture diagram of a repository |

## Permissions it needs

| capability | why | can it be avoided |
|---|---|---|
| run `c4v` (or `npm i -g c4-view`) | it is the renderer; the skill ships no code of its own | no — that is the product |
| write `docs/c4/<id>.json` inside the working repo | the model is the deliverable and versions with the code | yes: any path the user names |
| write `out/` for SVG/PNG | the rendered artefacts | yes: `--out` |
| optionally start a local HTTP server on `:8788` | the viewer, loopback only unless a token is set | yes, skip serving |
| optionally run a local Chromium | PNG export only | yes: SVG is the default artefact |

It never: reads outside the repo without being asked, calls a remote API, installs anything except `c4-view`
itself, or writes to `$HOME` / `/tmp`.

## Output shape

- one JSON model, `levels[]` of `path/nodes/edges/groups/flow`
- one SVG per level (PNG optional), identical bytes for identical models
- a one-line audit per level (`OK level="…" nodes=7 … aspect=5.2`), which is the receipt
- optionally a URL: `http://<host>:8788/d/<id>`

## Limits worth knowing before installing

- It describes architecture; it does not measure runtime behaviour.
- Two models (local 35B, DeepSeek v4.1) were tested; a harness that cannot reach the model cannot use the
  skill, and one that cannot read outside its working directory must be given the example that ships here.
- It will not fix a bad model by itself: if a gate fails, the feedback loop is the point, not an error.

## References

- scan reports: `docs/security/REPORT.md`
- how the level plan is decided: `skill/SKILL.md` §1c
- measured cost: `README.md` §Cost and footprint

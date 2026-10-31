# c4-view

A read-only C4 architecture renderer for agents. A JSON model goes in; a deterministic SVG, a PNG, and a
live viewer come out. There is no editing UI — the agent writes the model, the tool lays it out, an audit
decides whether it is deliverable.

```bash
node src/cli.ts audit  examples/shop.json --strict        # the gate
node src/cli.ts render examples/shop.json --out out/shop --png --strict
node src/cli.ts serve  --port 8788                        # grid at http://127.0.0.1:8788/ , one diagram at /d/shop
```


## Install on a fresh machine

```bash
git clone <this repo> c4-view && cd c4-view
npm install -g .          # or: npm link
c4v doctor                # says exactly what this machine is missing, if anything
```

Requirements, and nothing else:

| | |
|---|---|
| **Node 22.18+** | for a source checkout — Node runs the `.ts` files directly, nothing is transpiled |
| **Node 18+** | for an install from a packed tarball, which ships prebuilt JS in `dist/` (`npm run build`) |
| **Chromium / Chrome** | *optional*. Only PNG export uses it; found at `$C4_CHROMIUM`, then the usual install paths, then `PATH`. Without one, `--png` fails with the fix in the message and everything else works |
| **A font** | the widths come from a committed DejaVu table, so measurement is identical everywhere; the browser substitutes a narrower fallback if DejaVu is missing, which cannot overflow the boxes |

No runtime dependencies, no post-install downloads, no config file. `c4v` and `node src/cli.ts` are the
same program; the skill uses whichever is on the machine.

```bash
c4v audit  examples/shop.json --strict      # the gate
c4v render examples/shop.json --out out --png --strict
c4v serve  --port 8788                      # grid at / , one diagram at /d/shop
c4v service install --port 8788 --host 0.0.0.0   # same server as a systemd USER unit (survives logout)
npm run install-skill                       # copy the skill into ~/.hermes/skills
```


## This repo's own C4

`docs/c4/c4-view.json` — the agent-written model of this tool (context, containers, and the pipeline), kept
next to the code it describes. Rendered and gated like any other: `c4v render docs/c4/c4-view.json --strict`.

## Cost and footprint

Measured on this machine, not estimated. The numbers a user actually asks about before installing.

| what | number | how it was measured |
|---|---|---|
| **skill, input tokens** | **4,218 tokens** (15.5 kB, ~2,650 words) | tokenized with the Qwen3.5 tokenizer on the exact `skill/SKILL.md`; it is instructions only, no bundled code |
| package, download | **143 kB** | `npm pack` |
| package, unpacked | **425 kB** (79 files) | `npm pack --dry-run` |
| installed on disk | **652 kB** | `npm i -g` into a scratch prefix, `du -sh` |
| runtime dependencies | **0** | `package.json` has no `dependencies` field |
| RSS while serving | **95 MB** — of which ~42 MB is Node itself | `ps -o rss` on the running service |
| peak RSS rendering | **96 MB** | `/usr/bin/time -v` on the 11-level corpus |
| render speed | 11 levels in **50 ms** | same run |
| optional | Chromium/Chrome (~300 MB) for `--png` only | discovered at `$C4_CHROMIUM`, then PATH |

For scale: a whole diagram — model, layout, six audit gates, SVG, grid page — costs less than a single
image upload, and the expensive part of using it is the model that writes the JSON, not the tool.

## What it costs an agent to use

The skill is the context cost; the tool is not, because nothing is imported into the model. A run of
"build a C4 of this repo" measured **102–422 seconds** on a local 35B model (Qwen3.5-35B-A3B Q2, 21 tok/s),
on repositories of 130–3,235 files. Most of that is the model reading source, not rendering: rendering the
result is 50 ms.


## Why it exists

The renderer inside `droid-desktop` fights its layout: mermaid/dagre places boxes, then ~1,600 lines of
post-processing re-route the wires, nudge the labels and add a computed "spread" because dagre packs
neighbours too tightly. Non-overlap can only ever be approximated after the fact, and the production
store shows the cost — 26 of 121 nodes carry a hand-dragged offset.

This tool inverts that: **space for the wires is allocated during layout**, so overlap is impossible by
construction rather than corrected afterwards.

## The pipeline

```
model.json → model.parse → rank → order → place → route → emit → svg
                                        ↘ audit (gates the result)
```

| Stage | File | What it guarantees |
|---|---|---|
| parse | `src/model.ts` | every rejection names its place: `levels[2].edges[7].to: unknown node "x"` |
| rank | `src/layout/rank.ts` | longest-path layering, cycles broken into backward chains, one **dummy** per rank a long edge crosses |
| order | `src/layout/order.ts` | six barycentre sweeps, best crossing count kept, ties stable by input order |
| place | `src/layout/place.ts` | measured boxes (DejaVu advance table, no browser), gutters widened to their wire load |
| route | `src/layout/route.ts` | orthogonal; **one track per jog per gutter**, so two wires can never share a segment |
| labels | `src/layout/labels.ts` | chips ride their own wire, never over another chip or a node |
| emit | `src/svg/emit.ts` | one `<svg>`, colours as attributes, every agent-written string escaped |
| audit | `src/audit.ts` | the five gates + crossings/aspect, computed from the emitted numbers |

Determinism is a feature, not an accident: the same model produces byte-identical SVG in any process, so
two agent runs can be diffed. Text is measured from `data/font-metrics.json` (generated from
`DejaVuSans.ttf` by `scripts/gen-metrics.py`), never from a canvas.

## The audit is the product

```
OK level="" nodes=7 edges=8 node∧node=0 wire∧node=0 wire∧wire=0 chip∧chip=0 chip∧node=0 group∧node=0 crossings=1 backward=0 aspect=5.2
```

Gated at zero: `node∧node`, `wire∧node`, `wire∧wire` (two wires sharing a collinear segment),
`chip∧chip`, `chip∧node`, `group∧node`. Reported: `crossings`, `aspect`.

All six are gated: `group∧node` included, because a boundary box over non-adjacent members swallows
strangers and only the author can fix that — a tool that passes such a picture is lying. A wire may
touch its own end nodes **only within 8px of its port**; the old blanket exemption let a wire run 107px
through its own source and still audit clean. `test/audit.test.ts` plants one defect per gate, because a
grader that only prints zeroes proves nothing.

## The viewer

`serve` stores models under `~/.c4-view/<id>/model.json`. `/` is the grid: every diagram as a card with a
live thumbnail of its root level, its level count and its audit state — that is the link an agent hands
over when there are several concepts. A diagram page renders its SVG on the server, so a link works
before any JavaScript runs. The page then adds pan/zoom, hover, drill-down, a
legend, and the data-flow narration: **one edge animates at a time**, in `data-flow` order, with a
caption (`from → to · label · 3 / 9`). It stops at the end and offers replay rather than looping, and
`prefers-reduced-motion` gets a static dot.

## The model, in one level

```json
{
  "id": "shop", "title": "Shop",
  "levels": [{
    "path": "", "title": "Containers",
    "nodes": [{ "id": "web", "label": "Storefront", "subtype": "web-application", "tech": "React 19", "identity": "SHP-2" }],
    "edges": [{ "from": "web", "to": "api", "label": "REST", "style": "flow" }],
    "groups": [{ "id": "cloud", "label": "our cloud", "members": ["web", "api"] }],
    "flow": ["web->api"]
  }]
}
```

`subtype` is one of 49 C4 types and decides shape and colour. A node becomes drillable when a level
exists at `<parent path>/<node id>`.

Authoring rules, delivery contract and the troubleshooting table live in `skill/SKILL.md` — that is the
document an agent reads.

## Gates

```bash
node tools/gate.mjs   # ≤300 lines per file, purity, no `any`, no placeholders
npx tsc --noEmit      # strict
node --test           # 89 tests
pnpm test:coverage    # lcov → coverage/lcov.info
sonar-scanner         # 0 issues, quality gate OK (needs a SONAR token)
```

SonarQube (9.9, local) reads `tsconfig.sonar.json`, not `tsconfig.json`: its bundled TypeScript
cannot parse `es2023`, `allowImportingTsExtensions`, `verbatimModuleSyntax` or `erasableSyntaxOnly`,
and when the program fails it **silently skips every file** — the first scan reported a clean project
because it had analyzed nothing. Current state: 2,282 ncloc, 0 bugs / 0 vulnerabilities / 0 hotspots /
0 code smells / 0 duplicated lines / 0 debt, 92.6% line coverage, gate **OK**.

`tools/wb.mjs` is the task ledger the build was tracked in (`WORKBOOK.md`); `done` refuses without
evidence.

## Layout of the repo

```
src/types.ts          the frozen contract every stage speaks
src/model.ts          validation, normalisation, drill paths
src/metrics.ts        text measurement from the pinned font's advance table
src/flow.ts           the linear narration order
src/layout/           rank · order · place · route · labels · measure-node
src/svg/              shapes · emit  ·  src/theme.ts
src/audit.ts          the gates
src/render.ts         the pipeline  ·  src/cli.ts  ·  src/server.ts  ·  src/png.ts
public/               viewer.html · viewer.js · flow.js · viewer.css
test/                 70 tests (units, the real corpus, and the audit's own defects)
fixtures/             the owner's real concepts, exported read-only from ~/.droid/concepts.db
examples/             two hand-authored models: containers + drill, and two boundaries
docs/                 LAYOUT-SPEC.md (normative) · STAGE-SIGNATURES.md · HTTP-API.md
```

## Known ceilings

- `direction: 'LR'` only; `TB` is rejected with a named error rather than drawn wrong.
- A pure chain renders as a long strip (aspect > 8): add the real branches or split the level. The grid
  thumbnail letterboxes the whole drawing, so such a level shows as a thin strip — that is the aspect
  warning showing up in the preview, not a rendering bug.
- Boundaries require contiguous members; the audit reports when they are not.
- Self-loops are rejected (a self-relationship belongs in `tech`/`desc`).
- PNG export needs a Chromium binary (`/usr/bin/chromium`, or `C4_CHROMIUM`).
- SonarQube analysis needs a project token: `sonar-scanner -Dsonar.login=<token>`.

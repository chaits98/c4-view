# c4-view

A read-only C4 architecture renderer for agents. A JSON model goes in; a deterministic SVG, a PNG, and a
live viewer come out. There is no editing UI — the agent writes the model, the tool lays it out, an audit
decides whether it is deliverable.

```bash
node src/cli.ts audit  examples/shop.json --strict        # the gate
node src/cli.ts render examples/shop.json --out out/shop --png --strict
node src/cli.ts serve  --port 8788                        # then open http://127.0.0.1:8788/d/shop
```

No runtime dependencies. Node 26 runs the TypeScript directly; nothing is built, bundled or transpiled.

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
OK level="" nodes=7 edges=8 node∧node=0 wire∧node=0 wire∧wire=0 chip∧chip=0 chip∧node=0 group∧node=0 crossings=1 aspect=5.2
```

Gated at zero: `node∧node`, `wire∧node`, `wire∧wire` (two wires sharing a collinear segment),
`chip∧chip`, `chip∧node`, `group∧node`. Reported: `crossings`, `aspect`.

All six are gated: `group∧node` included, because a boundary box over non-adjacent members swallows
strangers and only the author can fix that — a tool that passes such a picture is lying. A wire may
touch its own end nodes **only within 8px of its port**; the old blanket exemption let a wire run 107px
through its own source and still audit clean. `test/audit.test.ts` plants one defect per gate, because a
grader that only prints zeroes proves nothing.

## The viewer

`serve` stores models under `~/.c4-view/<id>/model.json` and answers a page whose SVG is rendered on the
server — a link works before any JavaScript runs. The page then adds pan/zoom, hover, drill-down, a
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
node --test           # 70 tests
sonar-scanner         # 0 bugs / 0 vulnerabilities (needs a SONAR token, see below)
```

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
- A pure chain renders as a long strip (aspect > 8): add the real branches or split the level.
- Boundaries require contiguous members; the audit reports when they are not.
- Self-loops are rejected (a self-relationship belongs in `tech`/`desc`).
- PNG export needs a Chromium binary (`/usr/bin/chromium`, or `C4_CHROMIUM`).
- SonarQube analysis needs a project token: `sonar-scanner -Dsonar.login=<token>`.

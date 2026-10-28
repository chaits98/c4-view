# Smoke prompt — generate a C4 of this repo with the skill

Copy everything in the block into a **new session** (the point is that the session knows nothing about
how this repo was built). Paste it verbatim; the block is the test.

```
Load the skill `c4-diagram` (skill_view) and follow it exactly. You are testing that skill by documenting
the repo that implements it — do not modify the renderer's source.

TARGET: /home/canand/Desktop/Projects/c4-view — a read-only C4 architecture renderer: a JSON model goes in,
a deterministic SVG/PNG comes out, and a viewer serves it with a linear (one edge at a time) data-flow
animation. Read README.md, docs/LAYOUT-SPEC.md and skill/SKILL.md, then inspect src/ for the real runtime
pieces. Do not copy an existing model from examples/ — author the content from what you find.

PRODUCE a model at examples/c4-view.json (id "c4-view") with three levels:

1. path "" — C1 context, 4–7 nodes: who drives it (an agent), what it talks to (the filesystem store, the
   browser, SonarQube), and the diagram itself as the artifact handed to a person.
2. path "c4view" — C2 containers, 6–12 nodes: the real runtime pieces — CLI, the render pipeline, the model
   store, the HTTP server, the server-rendered page, the browser scripts (viewer + flow), the PNG
   rasteriser, the font-metrics table. Put ONE boundary group around the in-process pieces (contiguous
   members only) and leave server/browser outside it.
3. path "c4view/pipeline" — C3, 8–16 nodes: model.parse → rank → order → place → route → labels → emit →
   audit, with the ARTIFACT each stage hands the next as the edge label (Ranked, Placed, Routed, SVG,
   AuditReport), plus the audit's verdict gating the write (audit → cli; if the ranking makes that edge
   backward, leave it backward and let the corridor draw it).

RULES
- Declare `flow` on every level: the order a person would explain the system, every edge once. For C3 that
  is the real data path of one level, ending at the audit gate.
- `desc` on every node whose job is not obvious from its label; `tech` is the second line, not a sentence.
- Labels 1–3 words, edge labels are verbs, ≤20 nodes per level, no orphan node.
- Audit must be green: `node src/cli.ts audit examples/c4-view.json --strict` exits 0. If a gate fails, fix
  the MODEL (regroup, split, shorten) — never coordinates; there are none.
- The server may already be running on :8788 (`node src/cli.ts serve --port 8788` if not). Publish with:
  `curl -X POST -H 'content-type: application/json' --data @examples/c4-view.json http://127.0.0.1:8788/api/diagrams`

DELIVER, in this order
1. the grid link — `http://calm:8788/` (or `http://127.0.0.1:8788/` from this box) — with the new card visible,
2. one PNG of the C3 level: `node src/cli.ts render examples/c4-view.json --level c4view/pipeline --out out/c4-view --png --scale 1`,
3. the audit lines verbatim,
4. five lines on where the skill was wrong, silent, or made you guess — what you had to infer and what you
   would change in skill/SKILL.md. That section is the point of the exercise.

If you believe the renderer (not the model) is at fault, stop and report it with the model and the audit
line: that is a finding, not something to work around.
```

## What a failing run looks like

| Symptom | What it means |
|---|---|
| the agent hand-tunes positions, or asks where coordinates are stored | the skill failed: the layout is computed, there is nothing to tune |
| it asks you questions it could answer from the repo | the authoring rules are too thin |
| it delivers without the audit lines | the delivery contract was ignored |
| one level with 25+ nodes | the level-size guidance was ignored |
| a level with no `flow`, or the animation jumps around | the narration rule was missed |
| it "fixes" a red gate by editing `src/` | the skill's only hard rule (fix the model) was not believed |
| the C3 is a flat list of files instead of stages with artifacts | the model is describing code, not architecture |

## What a pass looks like

- three levels, every audit line `ok`, `group∧node=0`, `aspect` between ~1.5 and ~4
- the C3 edge labels are artifacts (`Placed`, `Routed`, `AuditReport`), not "calls" / "uses"
- the flow caption reads like a sentence: `model.parse → rank · Ranked · 1 / 9`
- the new card on `/` shows a thumbnail you can recognise at a glance
- the five-line critique contains at least one thing I should actually change

---
name: c4-diagram
description: >-
  Use when an agent must produce or update an architecture (C4) diagram for the
  user. Writes a JSON model, gates it on a geometry audit, renders deterministic
  SVG/PNG, and serves a read-only viewer that animates the data flow one edge at
  a time.
---

# C4 diagrams an agent can be trusted to ship

`c4v` (repo: `~/Desktop/Projects/c4-view`) renders C4 architecture diagrams from a JSON model.
There is no editing UI: the agent writes the model, the tool lays it out, the audit decides whether
it is deliverable, and the user opens a link.

**A diagram is delivered only when the audit is green.** The layout is computed — never nudge
coordinates, never hand-place a box. If the picture is wrong, the model is wrong.

## Commands

```bash
cd ~/Desktop/Projects/c4-view

node src/cli.ts audit  <model.json> --strict            # gates, exit 1 on any failure
node src/cli.ts render <model.json> --out out/<id> --png --strict
node src/cli.ts render <model.json> --level api --out ./api.svg
node src/cli.ts serve  --port 8788                     # http://calm:8788/d/<id>
```

- `--strict` is not optional in practice: without it a failed diagram still writes files.
- `--png` writes a 2x raster beside each SVG (`--scale 1` for a small one).
- `serve` stores models under `~/.c4-view/<id>/model.json`; `POST /api/diagrams` with the model body
  returns `{ id, url, audit }`. Pages are server-rendered, so a link works before any JS runs.

## The model

```json
{
  "id": "shop",
  "title": "Shop — containers",
  "layout": { "rankGap": 120, "nodeGap": 36, "labelMaxChars": 32 },
  "levels": [
    {
      "path": "",
      "title": "Containers",
      "nodes": [
        { "id": "browser", "label": "Customer browser", "subtype": "person", "tech": "mobile + desktop", "identity": "SHP-1" },
        { "id": "api", "label": "Orders API", "subtype": "microservice", "tech": "FastAPI", "desc": "validates and prices an order", "group": "cloud" },
        { "id": "db", "label": "Orders db", "subtype": "database", "tech": "Postgres 16", "group": "data" }
      ],
      "edges": [
        { "from": "browser", "to": "api", "label": "REST", "style": "flow" },
        { "from": "api", "to": "db", "label": "writes", "style": "flow" }
      ],
      "groups": [
        { "id": "cloud", "label": "our cloud", "members": ["api"] },
        { "id": "data", "label": "data tier", "members": ["db"] }
      ],
      "flow": ["browser->api", "api->db"]
    },
    { "path": "api", "title": "Orders API", "nodes": [], "edges": [] }
  ]
}
```

| Field | Rule |
|---|---|
| `levels[].path` | `""` for the root; a child level's path is the parent path + the node id (`api`, `api/db`). A node with a matching child level becomes clickable. |
| `subtype` | one of the 49 C4 subtypes (`person`, `system`, `external-system`, `web-application`, `microservice`, `database`, `cache`, `message-queue`, `api-gateway`, `service-logic`, `repository`, `adapter`, `class`, `function`, …). It decides shape and colour — pick the honest one; `rect` for everything is a tell. |
| `tech` | the second line: technology only, ≤ 5 words. |
| `identity` | stable human id (`SHP-3`). Keep it across edits; it is what the user refers to. |
| `rank` | absolute column hint. Use ONLY when the computed order fights the truth (an external system that must sit right of everything). |
| `flow` | the linear narration, every edge key once. Omit and the tool derives it depth-first from the source nodes. |
| `groups` | C4 boundaries. Their members must be **adjacent in the drawing** — see the gates. |

## Authoring rules (these are what make it readable)

1. **One idea per level.** C1 = 4–7 nodes, C2 = 6–12, C3 = 8–16, C4 = ≤ 12. Above 20 the level is a
   modeling mistake, not a layout problem — split it.
2. **Every node needs an edge.** An orphan box means the level mixes two stories.
3. **Labels are 1–3 words.** The long explanation belongs in `desc` (hover) or in a child level.
4. **Edge labels are verbs** (`writes`, `charges`, `publishes`), ≤ 3 words, and they are what the flow
   animation narrates.
5. **Point edges the way data moves.** A consumer that pulls is `queue -> worker`; drawing it backwards
   forces a return corridor and reads as a loop.
6. **Groups are physical boundaries, not topics.** Members must form one contiguous block of the
   drawing; if `group∧node` is non-zero the boundary swallows a stranger — regroup or split the level.
7. **Declare `flow` whenever the true order is not "walk the graph depth-first."** The audience is
   following one packet.
8. **Never encode state in the diagram** (counts, statuses, dates) — those rot. Architecture only.

## The loop

```bash
# 1. write model.json  (the only creative step)
node src/cli.ts audit model.json --strict          # 2. the gate
# 3. on failure: read the row, fix the MODEL, go to 2
node src/cli.ts render model.json --out out/shop --png --strict   # 4. artifacts
```

Audit output is one line per level:

```
OK   level="" nodes=7 edges=8 node∧node=0 wire∧node=0 wire∧wire=0 chip∧chip=0 chip∧node=0 group∧node=0 crossings=1 aspect=5.2
```

Gates that must be zero: `node∧node`, `wire∧node`, `wire∧wire` (two wires sharing a segment),
`chip∧chip`, `chip∧node`, `group∧node`. `crossings` and `aspect` are reported, not gated — but a
crossings count above ~2 per edge means the level is too tangled to read, and an aspect beyond ~8
means a chain that should be split.

## Delivering

Give the user three things and nothing else:

1. **the link** — `http://calm:8788/d/<id>` for one diagram, or `http://calm:8788/` for the grid when the
   user has several concepts (each card is a live thumbnail with its audit state),
2. **one PNG** — the level that carries the point, inline where the surface supports it,
3. **the audit line(s)** — the proof it is clean.

State which level answers which question ("C2 for the trust boundaries, `api` for the write path").
Never paste the JSON into chat unless asked; never claim a diagram "renders correctly" without the
audit line.

## Troubleshooting (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| `group∧node=2` | boundary members are far apart, so the box swallows other nodes | regroup so members are adjacent, or drop the boundary and split the level |
| `crossings` high, picture is spaghetti | many edges fan out of one node across ranks | split the level; or make the fan a boundary with its own child level |
| `wire∧node>0`, `wire∧wire>0` | a gutter carries more jogs than it has room for | raise `layout.rankGap` (the layout already widens gutters to the wire load, this is the last resort) |
| `chip∧chip>0` | two edge labels want the same spot | shorten the labels, or remove the least useful edge |
| a long thin strip (aspect > 8) | a pure chain with no branches | add the branch structure that actually exists, or split into two levels |
| `invalid model: levels[2].edges[7].to: unknown node "x"` | typo in an edge | fix the id; ids are the contract |
| `self-loop` rejected | an edge from a node to itself | this is a property of the node, not a relationship — put it in `tech`/`desc` |
| text clipped inside a diamond | label too long for a sloped shape | shorten the label |
| `direction: "TB" is not implemented` | portrait layout requested | use `LR`; split the level if it is too wide |
| flow animation jumps around | no `flow` declared, so the order is derived | declare `flow` in the order a person would explain it |

## What this is not

- Not an editor: no dragging, no resizing, no manual coordinates. A picture that needs hand placement
  needs a better model.
- Not a general graph drawer: C4 semantics (levels, boundaries, typed nodes) are the product.
- Not a "hero map" for a root view. A hand-designed banded map is the right tool for a C1 overview
  the owner will read closely — see the `c4-auto-generation` skill's rendering tier for that, and use
  this tool for the levels below it.

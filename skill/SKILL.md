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

## The brief is one line

Expect *"make a C4 of this repo: /path/to/repo"* and nothing else. You do not need to ask anything —
this section is the rest of the brief. Work in this order.

### 1. Survey the repo (before any JSON)

Read `README.md`, the manifest (`package.json` / `pyproject.toml` / `Cargo.toml` / `pom.xml`), then the
entry points (`src/main.*`, `src/cli.*`, `cmd/**`, `app.py`). Look at top-level directories only to learn
what each one is. You are hunting RUNTIME pieces, not files:

- processes that start and stop (a CLI, a server, a worker, a scheduled job),
- stores that outlive a process (database, a directory of files, a queue),
- what sits on the far side of a network edge (an API you call, a caller, a browser),
- the human who drives it.

Leave out: build tooling, tests, CI config, folder structure, `utils`. If deleting it would not change what
runs at 3am, it is not in the diagram.

### 2. Plan the levels, then walk the plan

| level | path | what earns a box |
|---|---|---|
| C1 context | `""` | the system as one box, its people, outside stores and services. 4–7 boxes. |
| C2 containers | `<id>` | every process, store, browser app, scheduled job. 6–12 boxes. |
| C3 components | `<id>/<container>` | the stages inside the one container that carries the point. 8–16 boxes. |
| C4 code | deeper | only when the owner asks about a specific module. ≤ 12 boxes. |

Ship **C1 + C2 always**, plus **one C3** for the container that carries the point (the pipeline, the request
path, the thing that broke). One C3, not five. Put the model in the target repo at `docs/c4/<id>.json` so it
versions with the code it describes; `<id>` is the repo folder name in lower-kebab.

### 3. Decide every edge by asking what crosses it

If a noun crosses the line, that noun is the label: `Ranked`, `AuditReport`, `orders.json`, `8 KB SVG`.
Otherwise the shortest true verb: `writes`, `charges`, `polls`. An edge you cannot label with cargo or a
verb is not an edge — delete it. This one habit is the difference between a diagram and a drawing.

### 4. Then the normal loop

Write the JSON, run `audit --strict`, fix the model until it is green, render, publish. Nothing changes
about the commands below — the survey only decides what goes in the file.


## Commands

`c4v` is on PATH whenever the package is installed. `node src/cli.ts` is the same program and only
matters inside a checkout of this repo — the path used to be written into this skill, and an agent on a
machine where the tool WAS installed concluded from the missing directory that the tool was missing.

```bash
command -v c4v || npm i -g c4-view                     # absent = install it; that is one line, not a blocker
c4v audit  <model.json> --strict                       # gates, exit 1 on any failure
c4v render <model.json> --out out/<id> --png --strict
c4v render <model.json> --level api --out ./api.svg
c4v serve  --port 8788                                 # local only; --host 0.0.0.0 needs a token
c4v service install --port 8788                        # same server, as a systemd user unit
```

**Never hand-write a model because the tool seems unavailable.** A JSON file that was never laid out by
`c4v` is not a diagram; it is a guess, and it will fail the gates it was never run against. Install the
tool, or say plainly that you could not and stop.

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
    { "path": "api", "title": "Orders API",
      "nodes": [{ "id": "handler", "label": "Order handler", "subtype": "api-controller", "tech": "FastAPI" }],
      "edges": [] }
  ]
}
```

| Field | Rule |
|---|---|
| `levels[].path` | `""` for the root; a child level's path is the parent path + the node id (`api`, `api/db`). A node with a matching child level becomes clickable. |
| `subtype` | one of the 49 C4 subtypes (`person`, `system`, `external-system`, `web-application`, `microservice`, `database`, `cache`, `message-queue`, `api-gateway`, `service-logic`, `repository`, `adapter`, `class`, `function`, …). It decides shape and colour — pick the honest one; `rect` for everything is a tell. |
| `tech` | the second line: technology only, ≤ 5 words. |
| `identity` | stable human id (`SHP-3`). Keep it across edits; it is what the user refers to. |
| `rank` | absolute column hint. Use ONLY when the computed order fights the truth (an external system that must sit right of everything). A hint is a promise about columns, not tidiness: hint a node to sit LEFT of its predecessor and you have declared that edge backward, and the router will answer with a corridor under the whole drawing. |
| `flow` | the linear narration, every edge key once. Omit and the tool derives it depth-first from the source nodes. |
| `groups` | C4 boundaries. Their members must be **adjacent in the drawing** — see the gates. |

## Authoring rules (these are what make it readable)

1. **One idea per level.** C1 = 4–7 nodes, C2 = 6–12, C3 = 8–16, C4 = ≤ 12. Above 20 the level is a
   modeling mistake, not a layout problem — split it.
2. **Every node needs an edge.** An orphan box means the level mixes two stories.
3. **Labels are 1–3 words.** The long explanation belongs in `desc` (hover) or in a child level.
4. **Edge labels are the cargo or the verb** (`Ranked`, `AuditReport`, `writes`, `polls`), ≤ 3 words,
   and they are exactly what the flow animation narrates.
5. **Point edges the way data moves.** A consumer that pulls is `queue -> worker`; drawing it backwards
   forces a return corridor and reads as a loop.
6. **Groups are physical boundaries, not topics.** Members must form one contiguous block of the
   drawing; if `group∧node` is non-zero the boundary swallows a stranger — regroup or split the level.
   If a level mixes what you run with what you only call (a browser, an external API, a rented database),
   that split earns a boundary. A level with no such seam needs none — do not draw boxes for decoration.
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
`chip∧chip`, `chip∧node`, `group∧node`. `crossings`, `backward` and `aspect` are reported, not gated.

- `crossings` above ~2 per edge: the level is too tangled to read — split it.
- `backward` above zero: an edge drawn right-to-left. Legal if the loop is real; if you did not ask for
  it, a `rank` hint caused it.
- `aspect` past ~8: the level is a long chain. That is fine when the sequence IS the point (a pipeline is
  explained left to right); split when the strip is wide because you flattened a hierarchy.

## Delivering

Give the user three things and nothing else:

1. **the link** the serve command printed — `<base>/d/<id>` for one diagram, `<base>/` for the grid when the
   user has several concepts (each card is a live thumbnail with its audit state). Hand over the URL the
   process printed; do not invent a hostname. If the user will come back to this later, or asked for the
   diagram to stay up, run `c4v service install` instead of a foreground `serve`: it installs a systemd user
   unit, prints the same URL, and the viewer survives your shell and their logout.
2. **one PNG** — the level that carries the point, inline where the surface supports it,
3. **the audit line(s)** — the proof it is clean.

State which level answers which question ("C2 for the trust boundaries, `api` for the write path").
Never paste the JSON into chat unless asked; never claim a diagram "renders correctly" without the
audit line.

## Before you deliver — all five, or it is not done

1. `node src/cli.ts audit <model> --strict` exits 0 on **every** level. Paste the lines.
2. Every level declares `flow`; every node has ≥ 1 edge; no level is over 20 nodes.
3. `group∧node=0` and every boundary's members are contiguous.
4. `aspect` is under ~8 (4–7 is normal for a genuine chain; a strip past 8 means split the level), and
   `backward` is the number of loops you MEANT — not one you accidentally created with a hint.
5. You rendered it and looked at the PNG of the level that carries the point.

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
| a wire dives under the whole drawing, or an edge you meant left-to-right reads right-to-left | the audit line says `backward=N`: a `rank` hint sits level with or left of a node feeding it, so that edge became a backward chain | remove the hint (the ranking was already right) or move it past its predecessors |

## What this is not

- Not an editor: no dragging, no resizing, no manual coordinates. A picture that needs hand placement
  needs a better model.
- Not a general graph drawer: C4 semantics (levels, boundaries, typed nodes) are the product.
- Not a "hero map" for a root view. A hand-designed banded map is the right tool for a C1 overview
  the owner will read closely — see the `c4-auto-generation` skill's rendering tier for that, and use
  this tool for the levels below it.

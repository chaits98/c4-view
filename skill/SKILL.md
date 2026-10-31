---
name: c4-diagram
license: MIT
description: >-
  Use when an agent must produce or update an architecture (C4) diagram for the
  user. Writes a JSON model, gates it on a geometry audit, renders deterministic
  SVG/PNG, and serves a read-only viewer that animates the data flow one edge at
  a time.
---

# C4 diagrams an agent can be trusted to ship

`c4v` renders C4 diagrams from a JSON model. There is no editing UI: you write the model, the tool computes
the layout, the audit decides whether it is deliverable, the user opens a link.

**A diagram is delivered only when the audit is green.** Never nudge coordinates, never hand-place a box —
if the picture is wrong, the model is wrong.

## First: the user's answers

Preferences live in `~/.c4-view/prefs.json`, and the question set grows with releases. Before drawing:

```bash
c4v prefs greeting --version <installed>   # one sentence to say, or nothing
c4v prefs pending                          # JSON: the questions still unanswered
```

- Empty `pending` → say nothing about setup.
- Otherwise ask **all of them in one short message**, each with its options and one clause on what the choice
  does, then record each with `c4v prefs set <id>=<answer>`. Never invent an answer, never ask twice, never
  make it a form. After an update ask only the new ones, and lead with why: *"c4-view can now share a diagram
  over your network — this computer only, or the local network?"*

## The brief is one line

Expect *"make a C4 of this repo: /path"* and nothing else. This section is the rest of the brief.

**1. Survey before any JSON.** Read `README`, the manifest (`package.json` / `pyproject.toml` / `Cargo.toml` /
`go.mod` / `pom.xml`), then the entry points (`src/main.*`, `src/cli.*`, `cmd/**`, `app.py`). Hunt RUNTIME
pieces, not files: processes that start and stop; stores that outlive a process; what sits across a network
edge; the human. Leave out build tooling, tests, CI, folder structure, `utils` — if deleting it would not
change what runs at 3am, it is not in the diagram.

**1b. The manifest is your coverage floor.** Nothing catches a component you never considered, so enumerate:

```bash
node -p "Object.keys({...require('./package.json').dependencies,...require('./package.json').devDependencies}).join('\n')"
grep -iA40 "dependencies\|require (" pyproject.toml requirements.txt go.mod 2>/dev/null | head -40
ls -d */ ; ls src/*/ 2>/dev/null
```

Every runtime dependency that is a seam — server, driver, parser, queue, renderer, auth, HTTP client — earns a
box. Every top-level directory holding runtime code earns a box or a child level (a Go repo with no manifest:
the package-root files are the inventory). Fold pure helpers into one `utilities` node and name them in its
`desc`; a seam you cannot account for is a component you missed. In graded runs the misses — `body-parser`,
`qs`, `radix tree`, `binding`, `render` — were always sitting in a manifest or a directory listing.

**1c. Decide what the repo IS — this decides the plan.**

| repo is… | C1 | C2 | content lives |
|---|---|---|---|
| **a system you run** (process, port, job) | the system, its people, its neighbours | deployables: process, worker, store, queue | C3 inside each container |
| **a library / framework** (consumed, not deployed) | the library, its developer, host apps, the registry | **one** honest box for the library + the process hosting it | **C3 is the point**: router, context, binding, render |

**A box is a container only if you could deploy, restart or scale it on its own.** If the boxes are files in
one package — `request.js`, `response.js`, `view.js` — that is a C3 wearing C2's title, and every geometry
gate will still call it clean. `Request` and `Response` are what flows through, not what runs.

**2. Plan the levels, then walk the plan.**

| level | path | earns a box | nodes |
|---|---|---|---|
| C1 context | `""` | the system, people, outside services | 4–7 |
| C2 containers | `<id>` | processes, stores, browser apps, jobs | 6–12 |
| C3 components | `<id>/<container>` | the stages inside the one container that carries the point | 8–16 |
| C4 code | deeper | only when asked about a module | ≤12 |

Ship **C1 + C2 always, plus one C3** (the thing that broke). One C3, not five. Write it inside the repo at
`docs/c4/<id>.json` — never `/tmp`, never `$HOME`: a sandboxed harness denies writes outside the working
directory and the run loses the file it just built. `<id>` = repo folder in lower-kebab.

**3. Decide each edge by asking what crosses it.** If a noun crosses, that noun is the label (`Ranked`,
`AuditReport`, `orders.json`, `8 KB SVG`); otherwise the shortest true verb (`writes`, `polls`). An edge you
cannot label with cargo or a verb is not an edge — delete it. This is the difference between a diagram and a
drawing.

## Commands

`c4v` is on PATH when the package is installed. There is **no checkout to find and no `src/cli.ts` to run** —
looking for one hits a sandbox denial, burns the budget on rejected commands, and ships a model that was never
audited. If `c4v` is missing: `npm i -g c4-view`, once.

```bash
command -v c4v || npm i -g c4-view
c4v audit  <model.json> --strict                    # gates, exit 1 on failure
c4v render <model.json> --out out/<id> --png --strict
c4v render <model.json> --level api --out ./api.svg
c4v serve  --port 8788                              # local; --host 0.0.0.0 needs a token
c4v service install --port 8788                     # same, as a systemd user unit
```

**Never hand-write a model because the tool seems unavailable** — a JSON that was never laid out is a guess,
and it fails gates it was never run against. Install it, or say plainly that you could not and stop.

`--strict` is not optional: without it a failed diagram still writes files. `--png` writes a 2× raster beside
each SVG (`--scale 1` for a small one). `serve` stores models under `~/.c4-view/<id>/model.json`;
`POST /api/diagrams` with the model body returns `{ id, url, audit }`. Pages are server-rendered, so a link
works before any JS runs.

## The model

**`assets/example.json`** ships beside this file: a complete two-level model — read it for the shape, the field
names and a boundary done right. It travels with the skill because a sandboxed harness may not be able to read
an installed package.

| Field | Rule |
|---|---|
| `levels[].path` | `""` at the root; a child is the parent path + node id (`api`, `api/db`). A node with a matching child level becomes clickable. |
| `subtype` | exactly one of these 49 — it decides shape and colour: `system, person, role, external-system, boundary, web-application, microservice, database, cache, message-queue, file-storage, search-engine, load-balancer, cdn, serverless-function, batch-job, container-registry, dns, api-gateway, ui-component, api-controller, service-logic, repository, middleware, plugin, module, event-handler, job, adapter, saga, workflow, library, config, migration, test-suite, class, interface, abstract-class, function, enum, type-alias, c4-module, schema, dto, constant, test-file, migration-file, config-file, script`. |
| `tech` | second line: technology only, ≤5 words. |
| `identity` | stable human id (`SHP-3`), kept across edits — it is what the user refers to. |
| `rank` | absolute column hint, only when computed order fights the truth (an external that must sit right of everything). A hint is a promise about columns: hint a node left of its predecessor and you have declared that edge backward, and the router answers with a corridor under the whole drawing. |
| `flow` | the linear narration, every edge key once. Omit → derived depth-first from the source nodes. |
| `groups` | C4 boundaries; members must be **adjacent in the drawing**. |

## Authoring rules

1. **One idea per level.** C1 4–7, C2 6–12, C3 8–16, C4 ≤12 nodes. Above 20 is a modelling mistake — split.
2. **Every node needs an edge.** An orphan box means the level mixes two stories.
3. **Labels 1–3 words.** The explanation belongs in `desc` or in a child level.
4. **Edge labels are the cargo or the verb** (`Ranked`, `AuditReport`, `writes`, `polls`), ≤3 words — they are
   exactly what the flow animation narrates.
5. **Point edges the way data moves.** A consumer that pulls is `queue -> worker`; backwards forces a return
   corridor and reads as a loop.
6. **Groups are physical boundaries, not topics.** Members form one contiguous block; `group∧node>0` means the
   boundary swallowed a stranger — regroup or split. A mix of what you run and what you only call (browser,
   external API, rented database) earns a boundary; a level with no such seam needs none.
7. **Declare `flow` when the true order is not depth-first.** The audience follows one packet.
8. **Never encode state** (counts, statuses, dates) — it rots. Architecture only.

## The loop

```bash
c4v audit  model.json --strict                         # after writing the model
c4v render model.json --out out/shop --png --strict     # only when green
```

On failure: read the row, fix the **model**, run the audit again.

```
OK   level="" nodes=7 edges=8 node∧node=0 wire∧node=0 wire∧wire=0 chip∧chip=0 chip∧node=0 group∧node=0 crossings=1 aspect=5.2
```

Gated, must be zero: `node∧node`, `wire∧node`, `wire∧wire` (two wires sharing a segment), `chip∧chip`,
`chip∧node`, `group∧node`. Reported only:

- `crossings` above ~2 per edge → the level is too tangled to read; split it.
- `backward` above zero → an edge drawn right-to-left. Legal if the loop is real; otherwise a `rank` hint
  caused it.
- `aspect` past ~8 → a long chain. Fine when the sequence IS the point; split when the strip is wide because
  you flattened a hierarchy.

## Delivering

1. **Publish by POST** — `curl -X POST --data @model.json <base>/api/diagrams`. Never copy files into
   `~/.c4-view` yourself: the store belongs to the server, and a sandbox usually denies the write. If the POST
   fails, report it; do not fall back to hand-placing files.
2. **The link the process printed** — `<base>/d/<id>`, or `<base>/` for the grid (each card is a live
   thumbnail with its audit state). Never invent a hostname. If the user will come back, `c4v service install`
   prints the same URL and survives their shell and logout.
3. **One PNG** of the level that carries the point, plus the **audit line(s)** as proof.

Before you say it is done, all five hold:

1. `c4v audit <model> --strict` exits 0 on **every** level, and you paste the lines.
2. Every level declares `flow`; every node has ≥1 edge; no level exceeds 20 nodes; and there are **at least two
   levels** — a root plus a child you can drill into. One flat level is a picture of one layer, and it is the
   most common way an agent stops early.
3. `group∧node=0` and every boundary's members are contiguous.
4. `aspect` <~8 (4–7 is normal for a real chain) and `backward` equals the loops you MEANT.
5. You rendered it and looked at the PNG of the level that carries the point.

Say which level answers which question ("C2 for the trust boundaries, `api` for the write path"). Never paste
the JSON unless asked; never claim it "renders correctly" without the audit line.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `group∧node=2` | boundary members far apart, box swallows strangers | regroup so members are adjacent, or drop it and split the level |
| `crossings` high, spaghetti | many edges fan out of one node across ranks | split the level, or make the fan a boundary with its own child |
| `wire∧node>0`, `wire∧wire>0` | a gutter carries more jogs than it has room for | raise `layout.rankGap` — last resort, gutters already widen to the wire load |
| `chip∧chip>0` | two edge labels want one spot | shorten the labels, or remove the least useful edge |
| long thin strip (aspect > 8) | a pure chain with no branches | add the branch structure that exists, or split into two levels |
| `unknown node "x"` | typo in an edge | fix the id; ids are the contract |
| `self-loop` rejected | an edge to itself | that is a property of the node — put it in `tech`/`desc` |
| text clipped in a diamond | label too long for a sloped shape | shorten the label |
| `direction: "TB" is not implemented` | portrait requested | use `LR`; split the level if too wide |
| animation jumps around | no `flow`, so the order is derived | declare `flow` in the order a person would explain it |
| a wire dives under the drawing, or an edge reads right-to-left (`backward=N`) | a `rank` hint sits level with or left of a node feeding it | remove the hint, or move it past its predecessors |

## What this is not

Not an editor — no dragging, no resizing, no manual coordinates; a picture that needs hand placement needs a
better model. Not a general graph drawer — C4 semantics (levels, boundaries, typed nodes) are the product. Not
a "hero map" for a root view the owner will read closely — that is the `c4-auto-generation` skill's rendering
tier; `c4v` is for the levels below it.

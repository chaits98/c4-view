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

- If the harness refuses these commands (they read `~/.c4-view`), **move on silently**: the preferences are
  optional, the diagram is not. Never let a rejected `prefs` call end the run.
- One of the questions asks whether to install a pre-commit gate **in the user's repo**. Stay on the
  no-answer state until they answer: no hook is written without an explicit yes. On `gate.install = auto`,
  run `c4v gate install` in the repo you are working in, once — after showing the one-line trade-off — and
  say in your hand-back that the hook is installed and where. On `manual`, say it is not installed, once,
  and never nag.
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
`desc`; a seam you cannot account for is a component you missed. The ones that get dropped are almost always
small: **an HTTP server, a test client, static-file serving, a proxy-trust setting, a query parser, content
negotiation, a middleware chain** — each earns a box, or its own named line in the `utilities` description. In graded runs the misses — `body-parser`,
`qs`, `radix tree`, `binding`, `render` — were always sitting in a manifest or a directory listing.

**1c. Decide what the repo IS — this decides the plan.**

| repo is… | C1 | C2 | content lives |
|---|---|---|---|
| **a system you run** (process, port, job) | the system, its people, its neighbours | deployables: process, worker, store, queue | C3 inside each container |
| **a library / framework** (consumed, not deployed) | the library, its developer, host apps, the registry | **one** honest box for the library + the process hosting it | **C3 is the point**: router, context, binding, render |

**A box is a container only if you could deploy, restart or scale it on its own.** Blunt test: **if you cannot
name a process or a store, the level is not a container level.** `Application`, `Router`, `Request`,
`Response`, `utils` are files in one module — that is C3 wearing C2's title, and every geometry gate will
still call it clean while the picture describes the wrong thing. `Request` and `Response` are what flows
through, not what runs.

**2. Plan the levels, then walk the plan.**

| level | path | earns a box | nodes |
|---|---|---|---|
| C1 context | `""` | the system, people, outside services | 4–7 |
| C2 containers | `<id>` | processes, stores, browser apps, jobs | 6–12 |
| C3 components | `<id>/<container>` | the stages inside one container that carries the point | 6–12 |
| C4 code | deeper | only when asked about a module | ≤12 |

Ship **C1 + C2 always**, then one C3 **per container that earns it** — typically one to three, never one for
the whole app and never one per source file. A container earns a C3 when its internals are the argument (the
thing that broke, the part a reader will ask about); `cli` and `server` both do in this tool, and a model with
three of them is honest, not greedy. What is dishonest is a level of six boxes you could not deploy or restart
separately. Write it inside the repo at
`docs/c4/<id>.json` — never `/tmp`, never `$HOME`: a sandboxed harness denies writes outside the working
directory and the run loses the file it just built. When you are describing a repo you may **not** write into
(the product is not yours, or the brief forbids it), write in your own workspace instead and say where the
model lives in your answer; the rule "inside the repo" applies to the repo you are working in. `<id>` = repo folder in lower-kebab.

**3. Decide each edge by asking what crosses it.** If a noun crosses, that noun is the label (`Ranked`,
`AuditReport`, `orders.json`, `8 KB SVG`); otherwise the shortest true verb (`writes`, `polls`). An edge you
cannot label with cargo or a verb is not an edge — delete it. This is the difference between a diagram and a
drawing.

## Commands

Audit judges the picture a page draws: a level with a parent is reported **composed** and the line says so
(`level="c4view/cli" (composed)`). `--flat` audits the authored level instead, for corpus checks only.

```bash
node src/cli.ts audit  model.json --strict --require-docs   # exit 0 is the deliverable
node src/cli.ts render model.json --out out/                # one file per level, flat
node src/cli.ts render model.json --expand c4v/cli --out out/   # the composed picture, as a page draws it
node src/cli.ts serve  --port 8788                          # read-only viewer
node src/cli.ts publish model.json [--as <id>]              # model AND docs into the viewer's store
```

**Hover text comes from the docs, and `POST /api/diagrams` copies only the model.** To see your docs in the
viewer, publish: `c4v publish model.json` copies the model and both doc directories into the store the viewer
reads. A model POSTed without them opens with an empty hover panel — that is the difference the two commands
make, and the reason to prefer `publish` whenever docs exist.

Docs live beside the model, **flat**, one directory for the whole model: `docs/c4/<id>/nodes/<node-id>.md` and
`docs/c4/<id>/edges/<from>__<to>.md`. `--require-docs` fails when any node or edge of any level has nothing to
say; `--json` prints the per-picture reports as JSON for a script.


`c4v` is on PATH when the package is installed. **Do not go looking for a checkout** of this tool: `node
src/cli.ts` is only for working *inside* the c4-view repo itself, and hunting for one elsewhere wastes the run
on sandbox denials. If `c4v` is missing: `npm i -g c4-view`, once.

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

`--strict` is not optional: without it a failed diagram still writes files. **Every path you write stays
inside the repo** — `--out`, render logs, scratch copies, everything. A sandbox denies `/tmp`, and a denial
ends the run as surely as a crash: an agent that copies a model to `/tmp` to try variations gets rejected and
ships the version with the failing level. When you want somewhere to experiment, use **`docs/c4/.scratch/` inside the repo** and leave it out of the
commit. `~/.c4-view/` belongs to the tool — it holds your preferences and the server's store — and a harness
that only allows the working directory will refuse it. Do not go looking in there. `--png` writes a 2× raster beside
each SVG (`--scale 1` for a small one). `serve` stores models under `~/.c4-view/<id>/model.json`;
`POST /api/diagrams` with the model body returns `{ id, url, audit }`. Pages are server-rendered, so a link
works before any JS runs.

## C4, in four levels — get these names right or the picture lies

| level | a box is | how many | drill? |
|---|---|---|---|
| **C1 context** | a person, your system, or an external system it talks to | 4–7 | yes: your system |
| **C2 container** | something that runs or stores: a process, a service, a CLI, a queue, a database, a hook | 5–12 | yes: **every** container you have something to say about |
| **C3 component** | a module, controller, service, repository **inside one container** | 6–12 | only if a component earns a C4 code level |
| **C4 code** | class, interface, table | ≤12 | no |

**The three mistakes that make a diagram worthless, in the order they get made:**

1. **Skipping C2.** Source files on the second level is not a container diagram — it is a component diagram
   wearing the wrong label. If a box would not appear in a deployment diagram (a process, a port, a store),
   it does not belong on C2.
2. **A lens for every container you can describe.** Ship C1 and C2 always; then one C3 per container you can
   honestly break into 6–12 components, and say in your hand-back which containers got one and why the others
   did not. There is no bonus for a fifth C3 and no credit for a layer of dead boxes.
3. **One lens per layer.** A layer where a single box opens and the rest are dead says the system has depth in
   exactly one place. That is almost never true: each container on C2 gets its own child level, and each of
   those opens in place, one at a time. Boxes that are genuinely leaves (a browser, an external API) stay leaves —
   that is a decision you can defend, not a default you were too lazy to check.
4. **Trusting a green audit that judged the wrong picture.** `c4v audit` judges **what a page draws**: a level
   with a parent is composed (parent, with that box expanded), because that is the picture a reader opens.
   `--flat` audits the authored level alone and is for corpus checks only — never for a claim that a drill looks
   right.

A child level is **the inside of one box**, nothing else: no sibling boxes from above, no second box expanded,
ports for every parent edge that crosses in. That is why it reads as a lens and not as a second diagram.

**Point the port at the node nearest the frame edge the edge arrives from.** A port that lands at the far end
of a long chain drags the outside box across the whole page and the wire ends up running under the drawing —
the troubleshoot table blames `rank` hints for that symptom, and it is usually the port.

**A box shown on two levels is one box.** If an external system appears at C1 and again at C2 (normal: a
container diagram does show what it talks to), give it the **same id and the same identity** on both levels.
Composition merges them; different ids make the page draw the same element twice, which is how a reader ends
up asking why there are two browsers.

**An element that talks to a box must appear on every level between it and that box.** Composition only
ever sees the level immediately above: leave the actor out of the container level and it vanishes the moment
somebody drills one level deeper — the component page ends up with one input where the context page showed
three.

**Every lens needs an entry and an exit — and the audit enforces it.** A box with edges in only one direction is
a `dead end` failure unless it is a `file-storage`, `database`, `cache` or `external-system` (sinks by nature).
A drilled page shows only the boxes whose edges cross the frame —
that is what makes it a lens. If the page has no inbound edge, the parent level is missing who calls this box;
if it has no outbound edge, the box looks like a dead end. Both are model gaps, not rendering choices: add the
edge (or say in the hand-back that the box is a genuine sink).

## The model

**`assets/example.json`** ships beside this file: a complete two-level model — read it for the shape, the field
names and a boundary done right. It travels with the skill because a sandboxed harness may not be able to read
an installed package.

| Field | Rule |
|---|---|
| `levels[].path` | `""` at the root; a child is the parent path + node id (`api`, `api/db`). A node with a matching child level becomes clickable — expect several clickable boxes per layer, each with its own level. |
| `subtype` | exactly one of these 49 — it decides shape and colour: `system, person, role, external-system, boundary, web-application, microservice, database, cache, message-queue, file-storage, search-engine, load-balancer, cdn, serverless-function, batch-job, container-registry, dns, api-gateway, ui-component, api-controller, service-logic, repository, middleware, plugin, module, event-handler, job, adapter, saga, workflow, library, config, migration, test-suite, class, interface, abstract-class, function, enum, type-alias, c4-module, schema, dto, constant, test-file, migration-file, config-file, script`. |
| `tech` | second line: technology only, ≤5 words. |
| `identity` | **required on every node**: a short stable id (`SHP-3`, `C4V-11`), kept across edits. Unique per
**element**: the same element drawn on two levels (an external system at C1 and C2) carries the SAME identity,
and that is what tells composition to draw it once. Two different boxes never share one. It is drawn on the box
and it is how a person names a box to you ("C4V-11 does X") — without it the user describes a box by position
and you get to guess wrong. |
| `rank` | absolute column hint, only when computed order fights the truth (an external that must sit right of everything). A hint is a promise about columns: hint a node left of its predecessor and you have declared that edge backward, and the router answers with a corridor under the whole drawing. |
| `flow` | the linear narration; **must** name every edge key of that level once (gated). Omit → derived depth-first from the source nodes. |
| `groups` | C4 boundaries (e.g. "what we run" vs "what we rent"); members must be **adjacent in the drawing**.
Do **not** wrap a drill level's interior in a group — composition already draws the dashed `frame-<host>` around
it, and an authored one on top doubles the boundary. |

## What the gates refuse (numbers, not taste)

`audit --strict` fails a level for any overlap — and for these four, which are about honesty rather than geometry:

| gate | fails when |
|---|---|
| **narration** | a declared `flow` does not name every edge of that level exactly once (the viewer appends the rest silently, so the animation runs in an order nobody chose) |
| **one id is one element** | the same node id appears on two levels with different identities — a shared doc would describe two different boxes |
| **no doors** | a drill level's box has no edges on the level above: the page would show a frame with nothing entering or leaving |
| **density** | more than **two wire crossings per edge** on a picture, composed or not |

Aspect is **reported, not gated**: a wide picture opens at 100% with a note instead of shrinking its labels to 5px.

### The number to aim at, not just the one to clear

`audit` prints `crossings=13 (1.08/edge, dense)`. The gate is 2/edge; a picture that reads without zooming is
under **0.5**:

| verdict | crossings per edge | what it means |
|---|---|---|
| `crisp` | ≤ 0.5 | reads at 100% |
| `ok` | ≤ 1 | fine, a wire or two overlaps |
| `dense` | ≤ 2 | legal, and it looks it — thin the level |
| `over` | > 2 | the gate refuses it |

**A dense level is a model problem, not a layout problem — and this is measured, not assumed.** Permuting the
declaration order of an 11-box / 12-edge level 60 times changed its crossings by zero: the ordering, ranking and
port assignment are already the best they can be *for that graph*. Only the graph changes the picture. Three
edits, in order of effect:

1. **Fewer boxes.** Two siblings that are always drawn together and always wired to the same things are one
   component (`store` + `prefs` → one box with two bullets in its doc). This is the big one: the same system at
   11 boxes reads at 1.08/edge, at 7 boxes at 0.00.
2. **Fewer bundles.** Three or more edges from one box to the same neighbour set is a layer boundary, not a
   design: collapse them into one edge whose label names the cargo.
3. **Split the level.** If the boxes are genuinely distinct, the level is doing two jobs — one of them belongs
   one level down.

## Authoring rules

1. **One idea per level, and the level must be the level it claims.** C1 4–7, C2 5–12, C3 6–12, C4 ≤12 nodes;
   a C2 box is something that runs or stores, a C3 box is a module inside one container. Above 20 is a modelling
   mistake — split.
2. **Every node needs an edge.** An orphan box means the level mixes two stories.
3. **Labels 1–3 words.** The explanation belongs in `desc` or in a child level.
4. **Edge labels are the cargo or the verb** (`Ranked`, `AuditReport`, `writes`, `polls`), ≤3 words — they are
   exactly what the flow animation narrates.
5. **Point edges the way data moves.** A consumer that pulls is `queue -> worker`; backwards forces a return
   corridor and reads as a loop.
6. **Groups are physical boundaries, not topics.** Members form one contiguous block; `group∧node>0` means the
   boundary swallowed a stranger — regroup or split. A mix of what you run and what you only call (browser,
   external API, rented database) earns a boundary; a level with no such seam needs none.
7. **Every level declares `flow`, in the order a person would explain it.** The derived depth-first order is
   rarely that order, and the flow is what the viewer animates — a level without it is not delivered. Every
   edge key appears exactly once. **If the user tells you the order, that is the order**: write their sequence
   verbatim into `flow`, one edge per step; do not re-derive it and do not "improve" it. Edges your list
   misses are appended at the end, so an incomplete list animates wrongly rather than failing loudly.
8. **Never encode state** (counts, statuses, dates) — it rots. Architecture only.

## The repo gate (only when the repo has one)

If the repo you are working in has `.githooks/pre-commit`, a commit that changes code outside `docs/c4/`
must also update the model and its docs, or you record why not — **before** you commit:

```bash
c4v gate check --staged                       # the hook runs this; read it, do not guess
c4v gate defer --reason "why the picture is still true"
```

A deferral is a claim a reviewer will read. Write what changed and why the diagram does not move; "no change
needed" alone is not a reason. It covers exactly the staged diff — one more edit and it is stale again.

## The loop

```bash
c4v audit  model.json --strict                         # after writing the model
c4v render model.json --out out/shop --png --strict     # only when green
```

On failure: read the row, fix the **model**, run the audit again.

**A level that prints `FAIL` is a hard stop.** One failing level means nothing is delivered — not that level,
not the other levels, not "I rendered the ones that passed". Fix the model until every line says `OK`, or
delete the level and say why you did.

```
OK   level="" nodes=7 edges=8 node∧node=0 wire∧node=0 wire∧wire=0 chip∧chip=0 chip∧node=0 group∧node=0 crossings=1 aspect=5.2
```

Gated, must be zero: `node∧node`, `wire∧node`, `wire∧wire` (two wires sharing a segment), `chip∧chip`,
`chip∧node`, `group∧node`. Reported only:

- `crossings` above ~2 per edge → the level is too tangled to read; split it.
- `backward` above zero → an edge drawn right-to-left. Legal if the loop is real; otherwise a `rank` hint
  caused it.
- `aspect` past ~8 is **reported, not gated, and not a defect on its own**: a genuine ten-stage pipeline is a
  ten-to-one strip and the viewer fits it (that is what the zoom presets are for). Split only when the strip is
  wide because
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
2. **Every level declares `flow`**, covering every edge key exactly once; every node has ≥1 edge; no level
   exceeds 20 nodes; and there are **at least two levels** — a root plus a child you can drill into. One flat
   level is a picture of one layer, and it is the most common way an agent stops early. More than **one** C3
   means you drew files, not components: cut it back to the container that carries the point.
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

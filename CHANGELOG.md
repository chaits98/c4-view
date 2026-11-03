# Changelog

All notable changes. The **model format** and the CLI are versioned together: a breaking change to the
JSON model is a breaking change to this tool, and is called out as such.

## [0.12.3] — a container's name sits above what it holds

Every host box was drawn with its label **centred**, and a host box is sized to the drawing inside it — so a
container's own name was written across the top of its contents in the app and in every export. A box that
holds a picture now draws its label at the head, and the picture starts below a **measured** head (the
label block's own height), not a guessed constant.

Also fixed on the way: an edge whose style the palette does not draw crashed the emitter; it falls back to a
flow line. And `nestedPicture` accepts a theme choice (`'dark'`) or a palette, instead of silently reading
`.edges` off a string.

## [0.12.2] — the export is the picture, the whole picture, and it paints its own canvas

Four things a reader hit at once:

- **An exported svg had no background.** The drawing carried dark-mode colours on a transparent canvas, so a
  browser painted it on white and every label washed out. Exports now paint their own canvas rect
  (`c4-canvas`) in the palette they were asked for.
- **A light PNG was the dark render.** `pngFor` cached one file per level and ignored the scheme, so the
  second export in another theme was served the first one's picture. The cache key carries the scheme now.
- **`All layers` stacked every level after the full diagram.** The nested picture already holds every level;
  the extra sections repeated the same boxes at other scales. It is the full diagram only.
- **The flow bar in an exported page was a dark pill with dark ink.** It inherited the page's text colour onto
  a hard-coded dark background. The bar takes its own `--c4-bar` / `--c4-ink` per scheme, and the driver now
  walks every nested picture in order, so the full diagram narrates all of its edges (1 / 27) instead of none.

## [0.12.1] — the layers download keeps the scheme too

The one export that ignored the theme was the one that ignores the level: `All layers` now carries `theme=`
like the other three.

## [0.12.0] — the export follows the screen, and the toolbar reads as one system

**Exports tell the truth about what you are looking at.** The svg keeps the theme you are reading in
(`?theme=` now rides along in every download link, and the export renders in that palette instead of always
dark). **All layers** now opens with the **full diagram** — "all layers" is the whole thing *and* the parts,
not the parts alone.

**Every exported page narrates.** The flow driver (`flow.js` + `flow-model.js`) is inlined into the file, so
an exported html walks its edges with the same caption, the same single dot and the same keyboard controls
the viewer has, with no server and no network.

Fixed at the source: the nested picture carried **no flow data at all** — `nest.ts` emitted each level with
an empty flow map, so the full view had nothing to animate.

**The toolbar is an M3 control surface** (research brief from a subagent, implemented in CSS — the product
still has no bundler, no React, no runtime deps): one 56px row, segmented pills for view mode and fit, a
stepper pill, filled export button, 40px targets, 8/16px gaps, `full`/`4px` radii only, state layers at
8%/10% and a 2px focus ring. The fit presets and the zoom stepper are two pills, not one — the readout and
the "Fit V" preset sat side by side and read as a duplicate button.

## [0.11.0] — the diagram leaves the viewer, and every level can come with it

A reader can now take the picture out of the tab: **Download** in the header offers

- **SVG** — the drawing, as a vector file;
- **PNG** — the drawing, as an image (the full view gets its own cached render);
- **HTML** — the drawing in a page that needs no server, no script, no fonts, and prints;
- **All layers** — every level one after another, which is what "the parts, not the whole" means.

Every export carries the level and the view it was asked from (`/d/<id>.svg?level=a/b&view=full`) and
answers with `Content-Disposition`, so the browser saves a named file instead of opening a tab of bare
markup: `c4-view-full.svg`, `c4-view-layers.html`.

The menu is a native `<details>` disclosure — it opens, closes and takes keyboard focus with no script.

## [0.10.2] — a host box is a frame, not a shape

The full view sized each host box to the drawing it holds, and then drew it with the outline its subtype
asked for — a stadium's corner radius is half its height, so a 1811×1540 host came out as a giant oval
slicing through its own contents. A box that holds a picture is always a plain rectangle now.

## [0.10.1] — the full view draws nested pictures, and every box keeps its edges

0.10.0 shipped a full view that dropped every edge living inside a frame: `c4view` folded to 20 nodes and
**8** edges while it owns 22, so a frame's boxes floated unconnected. Carrying those edges in the same flat
composition made a worse picture, not a better one — 27 edges ranked in one pass measured **7.96
crossings/edge, 40 wires crossing each other, 8 frames over a stranger**.

The fold was the mistake, not the edges. Every level is now drawn by the ordinary pipeline in its own
space and the host box in the parent is sized to hold that drawing; cross-level edges land on the host
box, which is where a C4 reader expects a boundary crossing. On the app's own model:

| | nodes | edges | crossings/edge | wire∧node | group∧node |
|---|---|---|---|---|---|
| 0.10.0 | 24 | 13 | 0.69 | 0 | 0 |
| fold + all edges | 24 | 27 | 7.96 | 40 | 8 |
| **nested pictures** | **27** | **27** | **0.19** | **0** | **0** |

Drill mode is unchanged: it still composes one frame into its parent, which is right when the rest of the
level has nowhere to be.

## [0.10.0] — a second view: every level open at once

The viewer had one mode: a level, with one box drilled. It now has two, and the second is the whole model in a
single picture — the root's boxes, each container's components inside its dashed frame, and those frames inside
their own.

- **`?view=full`** serves it, and the header carries **Drill in / Full diagram** as real links, the current mode
  marked with `aria-current`.
- **`c4v render model.json --all`** writes the same picture to a file (and `--png` with it).
- Nesting is a fold, not a second engine: `composeInto` is applied bottom-up, so a child arrives already holding
  its frames and the parent only nests them. Every geometry gate applies to the result — the app's own model
  composes to 24 nodes, 13 edges and 3 nested frames, and audits clean at 0.69 crossings per edge.
- A port that named a drilled host — `cli->server` — is matched after the fold by its far side
  (`cli/args->server`), and re-pointed at the frame's entry when the host becomes a frame. Both are what make
  "one picture" possible without hand-written ids.
- The return corridor now avoids every gutter's tracks, not just its own: a backward wire could land on a
  forward wire's vertical and read as one wire that splits.

## [0.9.5] — two fits, one meaning each

The three fit buttons are two, and they mean the same thing whatever the drawing's shape:

| | what fits | what scrolls |
|---|---|---|
| **Fit V** | the height | across, when it is wide |
| **Fit H** | the width | down, when it is tall |

So a column shows whole at Fit V and scrolls down at Fit H; a strip shows whole at Fit H and scrolls across at
Fit V. `100%` stays as the third chip, because it is a zoom, not a fit.

**The opening view is the whole drawing** — whichever of the two fits shows all of it — instead of the old
"too big, open at 100%", which showed a corner and called it the picture. Explicit `?zoom=` still wins, and the
note that apologised for the old behaviour is gone with it.

Measured in a browser: column `fit-v 91×468` (whole, no scrollbars) vs `fit-h 1241×6362` (fits the width,
vertical scrollbar); strip `fit-v 2043×453` (fits the height, horizontal scrollbar) vs `fit-h 1256×278` (whole).

## [0.9.4] — a centred drawing, and Fit in both directions

- **The canvas centres its drawing.** A tall column no longer hugs the left edge with dead space beside it;
  a drawing smaller than the canvas is centred in both axes, and one larger than it still scrolls to its own
  top-left corner (margin:auto inside a grid, the one centring that does not clip the overflow).
- **Fit is now three ways.** `Fit` (whole drawing), **`Fit W`** (fit the width, scroll down — what a column
  wants) and **`Fit H`** (fit the height, scroll across — what a strip wants), plus `100%`. Each is a real link,
  so it works before any script runs; the stage class is one name per zoom, so no two rules can disagree.
- The zoom model moved to `src/viewer-zoom.ts` and the stage rules to `public/stage.css`, both for the 300-line
  cap; the old class-swapping in `viewer.js` now clears every zoom class first, so opening `?zoom=fit-w` and
  then pressing + cannot leave two.

## [0.9.3] — an upright picture keeps its text inside its boxes

Three bugs the vertical layout shipped with, all found by looking at the drawing:

- **Boxes were as wide as a row is tall.** The upright picture was the horizontal one transposed, so every box
  inherited the row's height as its width and its label hung outside. A top-to-bottom level is now **laid out**
  with the axes declared: each node claims its text width on the axis that will carry it, and the transpose
  hands it back.
- **Edge labels had nowhere to sit.** Chip placement only ever looked for horizontal runs, and an upright
  picture has vertical wires, so every chip fell back to the wire's first point — on top of a box. Runs are now
  taken along the polyline's dominant axis, a chip slides along the run (needing its own height of room), and a
  vertical run that is too short for two chips lets one sit beside the wire.
- **A chip could still touch another by a fraction of a pixel.** The audit counts every overlap; placement
  counted only those over half a pixel. Placement now matches the audit.

Standing a level up is also measured, not assumed: when the upright layout would cross more wires than the
horizontal one (26 → 50 on a corpus level), the strip is kept.

## [0.9.2] — the strip stands up: vertical replaces the row wrap

The row wrap from 0.9.0 is **gone** — code, tests and the width budget with it. A wide level is now transposed:
the same drawing read top to bottom.

- `layout.direction` accepts `auto` (default), `LR` and `TB`. `auto` keeps C4's left-to-right and stands a level
  up only when it would not fit a laptop: wider than **1600 px** *and* past **3:1**.
- The transpose swaps x and y and nothing else. Crossings, overlaps and shared segments are invariant under that
  swap, so a vertical picture is provably as clean as the horizontal one — verified on the corpus: the same four
  levels report the same crossings (0 / 4 / 7 / 8) and `wire∧node=0` either way.
- The viewer opens a picture at 100% when it is too tall as well as too wide, and the card grid crops a thumbnail
  that is a strip in either direction instead of squeezing it.

Why this is better than wrapping: wrapping needed cross-row routing, a gap-lane allocator, per-row group frames
and a chooser that measured both layouts before it would commit — and on a dense level it still lost (26
crossings → 56). A transpose needs none of that, cannot regress, and vertical scrolling is what a browser
already does well.

## [0.9.1] — a rotated token no longer locks a browser out

`remember()` refused to rewrite a cookie that already existed, so a browser holding the token from before a
rotation stayed locked out: every page sent the old cookie, and the `?t=` link could not repair it because the
cookie was never refreshed. A valid `?t=` or `Authorization: Bearer` now replaces a stale cookie on the first
visit, and a token that does not check out is never stored.

Verified against a running server: stale cookie + fresh `?t=` → `302` with `Set-Cookie: c4token=<new>`;
stale cookie alone → `401`.

## [0.9.0] — a strip too wide to read folds into rows

### Added
- **Multi-row layout.** A level whose columns would run past `layout.rowWidth` (1600 px by default) wraps into
  rows of columns, and the wires that cross a row boundary get their own route: out of the source's side port,
  down the empty gutter beside its column, across the gap between rows, and into the target's side port. Every
  leg runs in a gutter or in the gap, so no cross-row wire can cut a box.
- Wrapping is chosen by measurement, not by width alone: the level is laid out both ways and the wrapped one is
  used only when it is at least 25% narrower **and** stays at or below one crossing per edge. On a dense level
  wrapping makes the picture worse (measured: 26 crossings → 56 on a 21-node level), and then the single row
  wins. `layout.rowWidth: 0` turns wrapping off per model.

### Fixed
- **`c4v serve` no longer prints the bearer token.** A service log outlives the run and is read by anyone who
  can read the journal; the token now goes to a terminal only. Under systemd, nohup or CI the notice says where
  the token lives and nothing more.
- **The one-click link is remembered in `~/.c4-view/open-url`** (mode 0600), one line for this box and one for
  the network. Nobody has to grep a token out of a log, and no log has to carry one.
- The grid's 250 ms budget was measuring node's coverage instrumenter, not the page (1.5 s under
  `--experimental-test-coverage`), which made the coverage run fail silently behind `--test-reporter=lcov`.

## [0.8.1] — what an outside agent found in one clean run

A fresh agent, given only the skill and "diagram this application", produced a model that passed on the first
audit (0.00 / 0.40 / 0.50 / 0.67 crossings per edge) — and reported eight defects in the tool and the skill.
Two were real bugs:

- **`render --out` wrote a picture nobody audits.** The files were the flat levels while the audit lines were
  the composed pictures (15 crossings in the report, 7 in the SVG). A level with one child now exports the
  composed picture — the same one `/d` draws — under the parent's own filename. `--expand <path>` still writes
  a single drill when a level has several children.
- **`--require-docs` over-counted.** A node drawn on three levels was reported three times (65 missing for 62
  files); each file is now named once, at the first level that wanted it.

Six were skill contradictions, all fixed: C3 was `8–16` in one table and `6–12` in two others; "one C3, not
five" fought "every container gets its own child level"; the skill forbade looking for `src/cli.ts` while its
own commands used it; ports never said to point at the node nearest the frame edge (which is what pushes a
witness across the page and runs its wire under the drawing); aspect had a number but no escape hatch for a
real ten-stage chain; and "write inside the repo" had no answer for a repo you must not write into.

## [0.8.0] — the picture is a model problem, and the report says so

`audit` now prints what an author should aim at, not just what the gate refuses: `crossings=13 (1.08/edge, dense)`.
`crisp` ≤ 0.5/edge, `ok` ≤ 1, `dense` ≤ 2, `over` > 2 — also in `--json` as `crossingsPerEdge` and `verdict`.

The measurement behind it, so nobody spends a day on the wrong fix: permuting the declaration order of an
11-box / 12-edge level **60 times** changed its crossings by zero, and forcing witnesses next to the frame
changed nothing either. The ordering, ranking and port assignment are already optimal for the graph. The same
system modelled at 7 boxes instead of 11 reads at 0.00/edge.

The skill gained that table and the three edits that thin a dense level (fewer boxes → fewer bundles → split
the level), in that order, with the numbers attached.

## [0.7.0] — the debt the gates were hiding

### Fixed
- **The new-code coverage gate measured `HEAD`, not the code being committed.** It diffed `base...HEAD`, so a
  pre-commit run judged the *previous* commit: new lines could slip in with the check green. It now diffs the
  working tree against the base, which is what a pre-commit hook has to judge.
- **The corpus fixture is no longer exempt.** `fixtures/droid.json` had two drilled levels that were dead ends
  and a 17-component level (the skill's own budget is 6–12); `git hook`-style gaps were being papered over with
  `--no-lens`. The fixture now models the user opening the app and the bridge pushing to the org runtime, the
  frontend level is 12 components, and `check.sh` audits it with the same rules as everything else.
- Three unreachable-but-unexcused branches cleared by removing the cause: the parsed command line carries
  `file: string` (`''` = none) instead of `string | undefined`, the no-file command set accepts `undefined`,
  and the flow-id fallback is covered by a hand-built-model test.

## [0.6.9] — the hook checks the thing that was letting smells through

### Fixed
- **The pre-commit gate could not see code smells.** It read Sonar's quality-gate status, whose conditions are
  **new code only**: once a smell is older than the new-code period it stops counting, so a green gate sat
  beside 11 open issues and every commit passed. The sonar step now also queries the issues API and fails on
  **any** unresolved issue, printing the messages. Negative test: a planted nested ternary fails the hook with
  "Extract this nested ternary operation…" and `sonar: 1 unresolved issue(s)`.
- The eleven smells that had accumulated are gone: cognitive complexity split in `argumentError` (moved to
  `src/cli-args.ts`) and `expandLevel` (split into `sharedWithParent`, `neighbours`, `composeEdges`), nested
  ternaries in `cli-output` and `audit`, a nested template literal in the level picker, a duplicated type
  import, and five unnecessary or unsafe assertions.

### Added — four gates and the rules behind them
| gate | fails when |
|---|---|
| narration | a declared `flow` does not name every edge of its level exactly once |
| one id is one element | the same node id appears on two levels with different identities |
| no doors | a drill level's box has no edges on the level above |
| density | more than two wire crossings per edge, composed or not |

Aspect stays reported, not gated: a wide picture opens at 100% instead of shrinking to 5px labels.

## [0.6.8] — the docs you write reach the viewer you wrote them for

### Fixed
- **Published docs were invisible.** `POST /api/diagrams` copies the model body only, while every page reads
  hover text from `<store>/<id>/<model-id>/nodes|edges` — so a repo with 30 written docs opened in the viewer
  with an empty hover panel, and the feature looked broken. `c4v publish <model.json> [--as <id>]` copies the
  model **and** both doc directories into the store; it reports how many docs travelled, and says so plainly
  when there are none.

### Documentation
- Skill: `publish` documented next to `serve`, with the reason — `POST` carries the model, `publish` carries
  the docs, and docs are what hover shows.

## [0.6.7] — a badge that means what the audit means

### Fixed
- **A card could say "audit clean" for a model `c4v audit --strict` refuses.** The badge read geometry only, so
  a lens with a dead end (a box nothing enters or nothing leaves) scored clean on the grid and failed on the
  command line. The badge and the `POST /api/diagrams` response now carry the same verdict as the audit:
  every composed picture, plus the modelling checks.
- The audit line marks a composed picture — `level="c4view/cli" (composed)` — so a green line cannot be
  mistaken for the authored level passing when it was the drilled picture that was judged.

### Added
- **Dead-end lenses are a failure.** A drilled box with edges in only one direction is refused unless it is a
  `file-storage`, `database`, `cache` or `external-system` (sinks by nature): a page with an entry and no exit
  is a model gap, not a rendering choice.
- `audit --no-lens` — geometry only, for corpus fixtures that predate the modelling rules.

## [0.6.6] — the health stamp tells you which code is actually running

### Fixed
- `/health` reported the version **on disk**, so a server left running from an older checkout looked current.
  The stamp is now `version@startedAt`, frozen at import: a stale process keeps naming the version it loaded,
  and its start time sits next to it. That is the difference between "the page is wrong" and "you are looking
  at yesterday's process" — which is exactly what produced the card-says-clean / page-says-failed report.

## [0.6.5] — the component page keeps its inputs

### Fixed
- The CLI's component page had **one** input (`git hook`) where the context page showed three. Composition
  only sees the level immediately above, and the container level had dropped the actor and the store: `who`
  and `files` were on C1 and nowhere else, so they vanished one drill down. Both now appear on the container
  level with the same id and identity, edges merged by identity — the component page shows `C4V-01`,
  `C4V-04`, `C4V-10` in, `C4V-12` out.

### Documentation
- Skill: an element that talks to a box must appear on **every** level between it and that box — otherwise
  it disappears at the next drill.

## [0.6.4] — one box, one name, one door in and one out

### Fixed
- **The same element drawn twice.** A box that legitimately appears on two levels (an external system at C1
  and C2) was composed into the page beside itself — `browser` and `reader`, two ids, one thing. Identity is
  the merge key now: same id + same identity is the same box, drawn once, its edges not doubled. The lens gate
  only forgives a repeated id when both sides carry the same identity; an unproven repeat is still refused.
- **A lens with no entry.** The hook page showed the CLI but not what starts the hook. The fix is in the model
  and the rule: a container level must show what feeds each box and what it feeds — `git → hook → cli →
  server → browser` — so every drilled page has an entry and an exit.
- `/health` reports the build stamp; the server is started with the token in its **environment**, not argv, so
  it no longer appears in `ps`.

### Documentation
- `skill/SKILL.md`: identity is required and is the merge key; a lens needs an entry and an exit; and when the
  user dictates a flow order, the agent writes **their** sequence verbatim into `flow` rather than re-deriving it.

## [0.6.3] — the lens shows the doors, and every box has a name

### Changed
- **A lens keeps only its neighbours.** An expanded page used to draw *every* sibling of the parent; now it
  keeps just the boxes with an edge through the frame — the entry and the exit. The server page had "git hook"
  on it because git hook happened to be nearby; it does not talk to the server at all.
- **The level picker is a tree**: indented by depth, prefixed with its C4 level (`C1 · …`, `C3 · …`), path in
  the tooltip. A flat list of paths made the reader work out the nesting.
- **Identities are required and drawn**: `C4V-11` on the box, unique in the model, stable across edits. They
  exist so a person can say "C4V-11 does X" to an agent instead of describing a box by position.
- **The frame's name is painted last**, on its own plate, so an edge label crossing the boundary can no longer
  sit on top of the name of the box you just opened.

### Fixed
- `/health` reports `build` (version + source mtime). The reported "card says clean, page says failed"
  mismatch was a **stale server process** still serving the pre-composition code; the build stamp makes that
  visible instead of mysterious.
- A diagram whose file will not parse is still a 500 that names the file (unchanged), but the audit endpoint
  for a diagram that does not exist is now a 404 in the tests rather than an untested branch.

## [0.6.2] — the audit now judges the picture you actually open

### Fixed
- **`c4v audit` judged the wrong picture.** It audited each level as authored, while every page with a parent
  serves that level **composed** (parent, with that box expanded). A drill could be unreadable — 36 crossings,
  11 wire∧wire on our own fixture — and the audit still said clean, the dashboard said "audit clean", and a
  release went out. The audit, the `POST /api/diagrams` response and `/api/diagrams/<id>/audit` now report the
  composed picture. `--flat` audits the authored level and exists for corpus checks only.
- **A frame now owns its columns.** When a box is expanded in place, any node outside the frame whose column
  fell inside it was drawn underneath the dashed boundary (`group∧node` 2–3 on every drilled page). Those
  neighbours are pushed a column clear on the side their edges point to.
- **A drill that cannot be drawn is a failed audit, not a 500**: a level whose box is missing from the level
  above reports `ok: false` instead of taking the request down.

### Changed
- `docs/c4/c4-view.json` — five levels, and **three drillable containers** on L2 (hook, CLI, server), each with
  its own component level. One clickable box per layer was a lie about the system's depth.
- `skill/SKILL.md` gains **C4, in four levels**: what a box is at each level, the three mistakes that make a
  diagram worthless (skipping C2, one lens per layer, trusting an audit that judged the wrong picture).
- `check.sh` audits corpus fixtures flat and everything a reader opens composed — stated in the step name.

## [0.6.1] — the model in this package describes the package

### Fixed
- `docs/c4/c4-view.json` now has the three C4 levels it should have had: L1 context → L2 the containers
  inside `c4-view` (CLI, viewer server, git hook) → L3 the components inside the CLI. The previous model
  jumped from the context straight to source files, so L2 was missing and L3 was wearing L4's clothes.
- 29 node and edge docs, flat under the model id, all passing `--require-docs`, and all three levels green
  under `--strict`.

## [0.6.0] — the picture you can drill into, and a gate that keeps it true

### Added
- **Drill lens** — a level whose path is `host/...` opens the box from the level above, in place: the host
  becomes a dashed frame holding its interior, and the outside boxes and their edges stay exactly where
  they were. Edges that cross the boundary re-attach through **ports**, which are declared, not inferred:
  `"ports": { "user->host": "router" }`. A crossing edge with no port is a gate failure.
- **`/d/<id>/<path>` means "the parent, with that box open"** — the picture a reader expects when they click
  a box. Every box with a level is a real `<a href>`, so middle-click, Back, copy-link and screen readers
  all work without JavaScript.
- **Docs beside the model** — `docs/c4/<id>/nodes/<node>.md` and `edges/<from>__<to>.md`, rendered in the
  hover panel by a ~150-line markdown subset with no dependency. Escaping happens before decoration, so a
  doc cannot inject markup. `c4v audit --require-docs` fails when a node or edge has nothing to say.
- **A repo gate, and it is a choice** — `c4v gate install` writes `.githooks/pre-commit` (chaining any hook
  already there) and points `core.hooksPath` at it. A commit that changes code outside `docs/c4/` must
  update the model and its docs, or record one line: `c4v gate defer --reason "…"`. The deferral is tied to
  the staged diff hash **and** the model hashes, so it cannot cover a later edit; `c4v gate report` lists
  every one of them. `c4v gate uninstall` removes the hook and keeps the log.
- **The trade-off is stated before anything is written**: the README section, the skill, and a `gate`
  preference that has no default — the answer stays absent until a person gives it.

### Changed
- The hover panel renders markdown from the docs and sits beside the node instead of over it.
- Expanded pages carry the docs of both levels, re-keyed to the ids that are drawn (`a` → `host/a`).
- `c4v render --expand <path>` and `parseModel` share one read of the file: the model is parsed once.

### Fixed
- The flow packet no longer travels over an edge label: the dot is inserted under the chip layer.
- The legend no longer looks like three checkboxes — it is a swatch plus a word, and the words say what the
  kinds mean instead of repeating the model's vocabulary.

### Gates
- **100% coverage on the lines a branch adds** (`tools/coverage-new.mjs`: lcov ∩ `git diff -U0 main...HEAD`),
  enforced in `check.sh` next to the 95% repo floor. A branch that cannot be reached is marked in the source
  with `coverage:invariant` and the reason, and the tool prints every exemption it honours.
- Sonar: 0 issues, 0 hotspots, gate OK; 394 tests.

## [0.5.0] — the checklist is finished

### Added
- **Item 5** — a skip link that is the first tab stop, `aria-current` on the crumb, and
  `<details id="c4-text">` rendered from the model: every container with its id and tech, every flow
  with its label. Tab order measured: skip → all → `<id>` → level.
- **Item 6** — `?sort=updated|title|audit` and `?audit=fail` as links, marked with `aria-current` and
  labelled in words; an empty filter says "Nothing is failing" instead of "No diagrams yet".
- **Item 7** — the token leaves the address bar: `?t=` answers `302` with every other parameter kept,
  sets the cookie on that response, and says `Cache-Control: no-store`. Pages and refusals are
  `no-store`; the 401 is a page for a browser and JSON for an agent.
- **Item 8** — a missing diagram, a missing level and a model that will not parse each render a page
  with one heading, one cause and one action; a broken model is a 500 that names the file.
- **Item 10** — the audit banner: up to three failing gates in words with counts, then "and N more".
- **Item 11** — a card over 400 nodes or 200 KB of SVG draws a placeholder instead of inlining the
  drawing; the grid answers in under 250 ms with a 401-node model in the store.

### Fixed
- **The drawing follows the page's scheme.** `auto` used to render the dark palette on a light
  document — 1.18:1, a page of ghost thumbnails, which the independent review scored as the single
  biggest defect. Every canvas colour is now `var(--c4-*)` over a `light-dark()` pair; exports keep a
  literal palette. Nine canvas pairs joined the contrast gate (36 pairs, 0 failing).
- `c4v service restart` (any typo) installed a unit instead of refusing.
- A labelled route with no points crashed the label pass.
- `"edges": {}` silently dropped every flow; nodes, edges and groups now agree that a field which must
  be a list is not an absence.
- `public/viewer.css` was 330 lines and the 300-line gate never looked at CSS; states split out, gate
  extended. The zoom readout no longer repeats the active chip, the app bar wraps at 390 px, and the
  401/404/500 pages follow `?theme=`.

### Changed
- Coverage: 300 tests, 99.8 % lines / 93.7 % branches, with the 95 % line+branch floor in
  `check.sh --full`. Damage guards are excluded by inline annotation, each naming the state it covers.

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

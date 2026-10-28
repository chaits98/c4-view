# Layout spec (normative)

Every stage is a pure function over the frozen types in `src/types.ts`. No DOM, no clock, no randomness:
the same `(LevelSpec, LayoutConfig)` must produce byte-identical geometry on every run and every machine.
Numbers are rounded with `round1 = (n) => Math.round(n * 10) / 10` **only when emitted**, never mid-computation.

## 0. Vocabulary

Only `direction: 'LR'` is implemented (the model validator rejects `'TB'` with a named error rather
than rendering a half-correct axis). Ports: an outgoing chain leaves a real node's **right** border, an
incoming chain arrives at its **left** border. A **dummy** has one port — `y = item.y + item.h / 2` — used
by both the incoming and the outgoing piece, so the wire continues straight through it.

- **rank** — a column (`direction: 'LR'`) of items.
- **item** — a real node, or a **dummy** (`d:<edgeKey>:<rank>`) that reserves corridor space so a long
  edge can cross an intermediate rank without touching a node.
- **gutter** — the empty horizontal band between rank *r*'s right edge and rank *r+1*'s left edge.
- **track** — one vertical straight inside a gutter, at a fixed x, owned by exactly one edge.
- **port** — the point where an edge meets a node border, at a y offset along that border.

## 1. `rank(level, cfg): Ranked` — `src/layout/rank.ts`

Input: `LevelSpec`. Output: ranks + items + chains.

1. **Chains, in input order.** For every `EdgeSpec`: `key = from + '->' + to`, `style = style ?? 'flow'`.
   Skip a duplicate key (keep the first). A self-loop (`from === to`) is a model error — `model.parse`
   rejects it before this stage.
2. **Cycle breaking.** Build the adjacency in input order. DFS from each node in input order; every edge
   that points at a node currently on the DFS stack is a *back edge*: mark `backward = true` and ignore it
   for ranking (it still renders, through the return corridor, §5).
3. **Ranks.** Nodes with a `rank` hint take it verbatim. Others: longest path over the forward edges —
   `rank[v] = max(rank[u] + 1)` over incoming forward edges, sources (no incoming forward edge) rank 0.
   Compute by repeated relaxation over the DAG (topological order from the same DFS), not recursion.
4. **Normalise.** Shift all ranks so the minimum is 0. A hint that leaves a forward edge with
   `rank[from] >= rank[to]` is not repaired: that edge is marked `backward` and routed around.
5. **Dummies.** For a forward chain with `span = rank[to] - rank[from] > 1`, insert one dummy per
   intermediate rank: id `d:<key>:<k>`, `w = 0`, `h = lane * 1.6`, `dummy = true`.
   `items = [from, d:<key>:r1, …, to]`, each item tagged with its rank.
6. **Items.** Every real node is an item with `w = 0, h = 0` — `place` measures them; `rank` must not
   guess sizes.
7. **Initial order.** Within each rank, items appear in: real nodes by input order first, then dummies by
   `(source node input index, chain input index)`. Set `index` accordingly.

## 2. `order(ranked, cfg): Ranked` — `src/layout/order.ts`

Barycenter sweeps, deterministic.

1. Build the **adjacency between adjacent ranks only**: for each chain, for each consecutive item pair
   `(a, b)` in `items`, record `a → b` (down) and `b → a` (up).
2. `crossings(ranks)` = sum over ranks `r` of inversions between the position maps of rank `r` and `r+1`
   over all adjacency pairs. Count with an O(n²) loop — the graphs here are ≤ ~200 items and clarity wins
   (`// ponytail: O(n²), swap for a BIT when a level exceeds a few hundred items`).
3. Six sweeps, `s = 0..5`; direction alternates (down, up, down, …). A *down* sweep visits ranks
   `1..last` and orders each rank by the mean position (in the previous rank) of its up-neighbours; items
   with no neighbour keep their current index as the key. Stable sort by `(barycenter, current index)`.
   An *up* sweep mirrors it.
4. Keep the ordering with the lowest `crossings`; ties go to the earliest sweep. Re-index ranks 0..n-1.
5. Return a **new** `Ranked`; do not mutate the input.

## 3. `place(ranked, level, cfg, measure): Placed` — `src/layout/place.ts`

1. **Measure a real node** (`direction: 'LR'`): call
   `measureNode(node, cfg, m)` from `src/layout/measure-node.ts` (orchestrator-owned, done) — it returns
   `{ w, h, lines, identity?, tech? }`. Its `w`/`h` already contain the pads and the 3-line cap.
   Then apply **port pressure** to the height only:
   - `portsOut` = chains whose `items[0]` is this node; `portsIn` = chains whose last item is this node;
     `maxPorts = max(portsOut, portsIn)`; `h = max(measured.h, (maxPorts + 1) * cfg.portGap)`.
   - `w` and `h` are integers (ceil).
2. **Column widths.** `W[r] = max(w of real items in rank r)`, dummy items contribute 0.
3. **Columns.** `x[0] = 0`; `x[r+1] = x[r] + W[r] + cfg.rankGap`. A real node is centred in its column:
   `node.x = x[r] + (W[r] - w) / 2`. A dummy's `x = x[r] + W[r] / 2` (it is a point on the corridor).
4. **Rows.** Per rank in order: `cursor = 0`; for each item: `item.y = cursor`;
   `cursor += item.h + (item.dummy || next.dummy ? cfg.lane : cfg.nodeGap)`.
   Then centre the rank vertically: `dy = (maxRankHeight - rankHeight) / 2`, added to every item's y.
5. `size = { w: x[last] + W[last], h: maxRankHeight }`.
6. **Groups.** For each `GroupSpec` with ≥1 placed member: `box = bbox(members)`, expanded by
   16 on every side, plus 22 on top for the label. Emit `{ id, label, box }`. Groups never affect
   node placement (a boundary is crossed by external edges by design) and are **not** counted as
   nodes by the audit.
7. Round every emitted coordinate to 1 decimal. A `Placed` must contain `boxes` for real nodes only and
   `items` for everything (including dummies).

## 4. `route(placed, cfg, measure): Routed` — `src/layout/route.ts`

Orthogonal, one track per jog, **no two routes may share a collinear segment**.

1. **Ports.** For each item and each used side (`r` for outgoing at rank r, `l` for incoming), collect the
   touching chains ordered by the other end's y (its item's y centre); tie-break by chain key. Chain *i*
   of *n* gets `y = sideTop + (i + 1) / (n + 1) * sideHeight` (`sideHeight` = item h).
   `sideTop` = item.y for `l`/`r`.
2. **Forward chain.** Walk consecutive pairs `(a, b)`:
   - `x0` = right edge of `a` (dummies: their `x`), `y0` = a's port for this chain;
   - `x1` = left edge of `b` (dummies: their `x`), `y1` = b's port;
   - if `Math.abs(y0 - y1) < 0.5` → emit `(x0,y0) → (x1,y1)` as two points;
   - else the piece needs a jog: take this chain's track x **inside that gutter** and emit
     `(x0,y0) → (tx,y0) → (tx,y1) → (x1,y1)`.
   Join consecutive pieces by dropping a duplicated point. The whole chain must be one polyline:
   horizontal runs only at port y values, verticals only at track x values.
3. **Track allocation, per gutter.** A gutter is `[left, right]` = `[x of rank r's right edge,
   x of rank r+1's left edge]`. Chains needing a jog in that gutter are sorted by (chain key) and get
   `tx = left + cfg.lane * (i + 1)`, `i` from 0. **Assert** `tx <= right - cfg.lane`; if the gutter is too
   narrow for its jogs, spread the tracks evenly across `[left + lane, right - lane]` instead
   (deterministic, still distinct).
4. **Backward chain** (`chain.backward`): source leaves from its **bottom** border at a port, drops into
   the return corridor below the drawing, runs left to the target's column, and rises into the target's
   **bottom** border port. Corridor row = `size.h + 18 + k * (cfg.lane + 4)` where `k` is the index of the
   backward chain sorted by key. Update `Routed.size.h` to `max(size.h, last corridor row + cfg.lane)`.
5. **Label chips.** For each chain with a `label`:
   - text size `fontSize - 1`, `w = measure.width(text, fontSize-1) + 12`, `h = 18`;
   - candidate centres: for each **horizontal run** of the polyline, longest first, the run's midpoint
     and then offsets of `±(w * 0.6) * j` for `j = 1..3` clamped inside the run;
   - accept the first candidate whose box does not overlap (by ≥1px) any already-placed chip box or any
     real node box; if none is accepted, place the first candidate anyway (the audit will report it —
     never invent a position off the wire).
   - Chips are placed in chain-key order.
6. `Routed.size` starts as `placed.size` and grows for the corridor; add 8 of padding on each side is
   **not** done here (the emitter adds the viewBox offset).

## 5. `emit(...)` — `src/svg/shapes.ts` + `src/svg/emit.ts`

`emit(placed, routed, level, cfg, theme): string` returns one self-contained `<svg>` element.

- viewBox `0 0 ceil(w+16) ceil(h+16)`, root translated by `8,8`.
- Layer order (back to front): groups → routes → nodes → chips.
- Every number goes through `n = (v) => String(Math.round(v*10)/10)`.
- No `<style>` block: colours are attributes (`fill`, `stroke`) taken from `theme`, so an exported SVG
  renders identically outside the app.
- Text: `font-family` from the theme, `dominant-baseline="middle"`, `text-anchor="middle"`.
- A node carries `data-id`, `data-kind`, `data-desc` (when `desc`), `data-drill="<child path>"` (when a
  child level exists — passed in as a set of paths). A route carries `data-key`. These attributes are the
  viewer's only contract.
- Shapes: see `src/svg/shapes.ts` — one function per shape id producing a path/element string inside the
  box; the mapping subtype → shape is in the app's original taxonomy (stadium, actor/rounded, cylinder,
  hexagon, diamond, subroutine, trapezoid, trapezoidAlt, bars, circle, parallelogram, rect).

## 6. `audit(placed, routed, level): AuditReport` — `src/audit.ts` (orchestrator-owned)

Already implemented against these rules; stages must satisfy it, not the reverse.

- `nodeNode`: pairwise box intersection area > 0.5.
- `wireNode`: any route interior point (or segment sample at 2px steps) strictly inside a node box that is
  not one of that route's own end nodes.
- `wireWire`: any two routes sharing a collinear segment longer than 2px (same y ±0.5 for horizontals,
  same x ±0.5 for verticals, with overlapping ranges).
- `chipChip`, `chipNode`: box intersection area > 0.5.
- `crossings`: orthogonal crossings between two routes (a vertical of one crossing a horizontal of the
  other) — reported, never gated.
- `ok = nodeNode === 0 && wireNode === 0 && wireWire === 0 && chipChip === 0 && chipNode === 0`.

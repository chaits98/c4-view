# HTTP API + viewer DOM contract

The server is the only process; the viewer is a static script it serves. Both are pinned here because
they are written by two different workstreams.

## Server (`src/server.ts`)

`serve({ port, root, host })` — `root` defaults to `~/.c4-view`, `host` to `127.0.0.1`. It stores one
directory per diagram: `<root>/<id>/model.json` and `<root>/<id>/out/` for exports. Nothing else is
written, nothing outside `root` is read. It resolves to the listening `http.Server` (so a test can bind
`port: 0` and read the real port from `server.address()`); the CLI keeps the process alive.

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/` | — | the index grid: every stored diagram as a card, each with a live thumbnail of its root level, its level count, its updated time and its audit state. Server-rendered; the empty state names the POST command. |
| GET | `/health` | — | `{ ok: true, diagrams: <n> }` |
| GET | `/api/diagrams` | — | `[{ id, title, levels: string[], updated }]` |
| POST | `/api/diagrams` | the model JSON (≤ 2 MB) | `201 { id, url, audit }` — validates with `parseModel`, 400 `{ problems: string[] }` on a bad model |
| GET | `/api/diagrams/:id` | — | the stored model JSON |
| GET | `/api/diagrams/:id/audit` | `?level=<path>` | `AuditReport[]` (or one) |
| GET | `/d/:id` | — | the viewer page for the root level |
| GET | `/d/:id/<path…>` | — | the viewer page for that level (path segments joined by `/`) |
| GET | `/d/:id.svg` | `?level=<path>` | `image/svg+xml` |
| GET | `/d/:id.png` | `?level=<path>` | `image/png` (rasterised through `svgToPng`, cached in `<root>/<id>/out/`) |
| GET | `/viewer.js`, `/viewer.css` | — | the static viewer assets from `public/` |

Rules that are not negotiable:

- `:id` matches `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`; every level path segment matches the same pattern or
  is empty. Anything else is **404**, not a sanitised guess — no `..`, no absolute paths, no symlinks.
- The response is `text/html; charset=utf-8` and the page is **server-rendered**: the SVG for the level is
  inline in the body. A page that only fills itself in via `fetch` is a blank page to a link preview.
- A model that fails validation answers `400` with the `problems` array verbatim; a level that does not
  exist answers `404` listing the paths it does have.
- Unknown method → `405` with `Allow`. Request bodies over 2 MB → `413`, connection closed.
- No `eval`, no template interpolation of untrusted text into HTML: the SVG comes from the emitter
  (already escaped), the title and breadcrumb labels go through a local `esc()`.
- Log one line per request to stdout: `METHOD path status ms`.

## Viewer DOM contract (`public/viewer.html` is rendered by the server)

Breadcrumbs always start with `<a href="/">all</a>`, so one diagram is never a dead end.

```html
<body data-diagram="<id>" data-level="<path>" data-root="/d/<id>">
  <header class="c4-bar">
    <nav id="c4-crumbs"><a href="/d/<id>">id</a> / <span>level</span></nav>
    <select id="c4-levels"><option value="<path>" selected>Title</option>…</select>
  </header>
  <main id="c4-stage"><svg …></svg></main>          <!-- server-rendered, the only drawing -->
  <aside id="c4-hover" hidden></aside>               <!-- hover card: fills with data-desc -->
  <div id="c4-legend"></div>                         <!-- kind swatches, built by viewer.js -->
  <div id="c4-mini"></div>                           <!-- minimap host, optional to fill -->
  <script src="/viewer.js" defer></script>
</body>
```

```html
<link rel="stylesheet" href="/viewer.css">
```

Node markup the viewer reads (already emitted): `g.node[data-id][data-kind][data-desc?][data-drill?]`,
`path[data-key]`, `g[data-chip]`.

## Viewer (`public/viewer.js`, `public/viewer.css`)

Behaviour, in this order of importance:

1. **Fit on load**: one transform on the SVG's root `<g class="c4-root">` (or the svg's first `<g>`), so
   the whole drawing is visible with 24px padding. Never mutate the SVG's own width/height.
2. **Pan**: pointer drag on the stage moves the view; pointer capture; no text selection.
3. **Zoom**: wheel zooms about the cursor, clamped 0.3–3; `+`/`-`/`0` keys zoom in/out/fit.
4. **Hover**: a node with `data-desc` shows `#c4-hover` near the cursor with its label + description;
   leaving hides it. Hover must not move the view.
5. **Drill**: a click (not a drag — a move of < 4px) on a node with `data-drill` navigates to
   `data-root + '/' + data-drill`.
6. **Levels**: changing `#c4-levels` navigates to the chosen level; the breadcrumb links are the server's.
7. **Legend**: one swatch per kind present in the drawing, colours read from the emitted `fill` of the
   first node of that kind — never a hardcoded palette.
8. No editing, no dragging of nodes, no network calls other than navigation.

Expose `window.__c4 = { fit, zoomAt, toWorld, view }` for the headless probe.

# Changelog

All notable changes. The **model format** and the CLI are versioned together: a breaking change to the
JSON model is a breaking change to this tool, and is called out as such.

## [Unreleased]

### Added
- JSON Schema for the model (`schema.json`), so editors autocomplete it and other tools can validate it.
- A single-file HTML export is planned; the server-rendered viewer is the current answer.

## [0.2.2] — service hosting

### Added
- `c4v service install|uninstall|status` — a systemd user unit, so the viewer survives the shell that
  started it. Linux only, by design.

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

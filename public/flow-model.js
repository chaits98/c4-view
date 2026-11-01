/**
 * The flow contract as pure functions: no DOM, no state.
 *
 * `public/flow.js` owns the drawing and the timers; this file owns the rules that the
 * checklist actually names — the caption format, which key means what, what the primary
 * button says, and when the live region is allowed to speak. Being DOM-free is what lets
 * `node --test` hold the contract without a browser: see `test/flow-model.test.mjs`.
 */

/**
 * `{from} → {to} · {label} · {n} / {total}`, fixed (ux-guideline §4.2).
 * `from`/`to` are the node labels as printed in the SVG; a missing label prints
 * `unnamed` rather than an empty field between two `·`, which reads as a bug.
 */
export const caption = (from, to, label, index, total) =>
  `${from} → ${to || ''} · ${label || 'unnamed'} · ${index + 1} / ${total}`

/** The keys the bar answers, and what they do. Scope is the caller's job. */
const ACTIONS = {
  ' ': 'toggle',
  Spacebar: 'toggle',
  ArrowRight: 'next',
  ArrowLeft: 'prev',
  Home: 'first',
  End: 'last',
  r: 'replay',
  R: 'replay',
  Escape: 'stop',
}

/** Modifier combinations belong to the browser (zoom, back, new tab), never to us. */
export const actionOf = (event) =>
  event.altKey || event.ctrlKey || event.metaKey ? null : (ACTIONS[event.key] ?? null)

/**
 * The primary button's face: Play → Pause → Replay, and Replay is only reachable
 * once the last edge is the current one (ux-guideline §4.1, §4.4).
 */
export const face = (index, total, playing) => {
  const atEnd = index >= total - 1
  return {
    word: playing ? 'Pause' : atEnd ? 'Replay' : 'Play',
    glyph: playing ? '⏸' : atEnd ? '↻' : '▶',
    state: playing ? 'pause' : atEnd ? 'replay' : 'play',
    replay: atEnd,
  }
}

/** A step every 1.1 s floods a polite queue, so the caption goes quiet while playing. */
export const live = (playing) => (playing ? 'off' : 'polite')

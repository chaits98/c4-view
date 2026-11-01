/* c4-view flow — the linear narration: one dot, one edge at a time, in the emitter's
 * data-flow order. Loaded after viewer.js as a module; reads the same drawing.
 *
 * Contract (ux-guideline §4): the rules live in flow-model.js (caption format, keys,
 * button face, live region); this file drives the drawing with them.
 *   - first paint is paused on step 1: the first edge is lit, the caption filled with
 *     `1 / {total}`, nothing moving and nothing announced;
 *   - keys are scoped to this bar, never the document;
 *   - at the last edge the dot and the caption stay and the button reads Replay — no loop.
 */
import { actionOf, caption, face, live } from './flow-model.js'

const stage = document.getElementById('c4-stage')
const svg = stage && stage.querySelector('svg')
const rootG = svg && (svg.querySelector('g.c4-root') || svg.querySelector('g'))
if (rootG) {
  const NS = 'http://www.w3.org/2000/svg'
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  /** ux-guideline §4.1: ~1.1 s per step — 900 ms of travel, then the caption holds. */
  const TRAVEL = 900
  const DWELL = 200
  /** reduced motion still advances, as a slide deck: no interpolation at all. */
  const STEPPED = 1600

  const domPaths = [...svg.querySelectorAll('path[data-flow]')]
  // a chip carries its edge key now; the positional pairing stays as the fallback for an
  // older exported svg
  const chipEls = [...svg.querySelectorAll('g[data-chip]')]
  const byKey = new Map(chipEls.filter((g) => g.dataset.key).map((g) => [g.dataset.key, g.textContent.trim()]))
  const positional = chipEls.length === domPaths.length
    ? new Map(domPaths.map((el, i) => [el.dataset.key, chipEls[i].textContent.trim()]))
    : new Map()
  const edges = domPaths
    .map((el) => ({
      el,
      step: Number(el.dataset.flow),
      key: el.dataset.key || '',
      label: byKey.get(el.dataset.key) ?? positional.get(el.dataset.key) ?? '',
    }))
    .filter((e) => Number.isFinite(e.step))
    .sort((a, b) => a.step - b.step)

  // the caption names nodes the way the drawing does; viewer.js owns that reading
  const nodeById = new Map([...svg.querySelectorAll('g[data-id]')].map((g) => [g.dataset.id, g]))
  const labelOf = (id) => {
    const node = nodeById.get(id)
    const read = window.__c4 && window.__c4.labelOf
    return (node && read ? read(node) : '') || id
  }

  function button(id, glyph, name) {
    const el = document.createElement('button')
    el.type = 'button'
    el.id = id
    el.className = 'c4-flow-btn'
    el.setAttribute('aria-label', name)
    const icon = document.createElement('span')
    icon.className = 'c4-flow-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = glyph
    el.append(icon)
    return el
  }

  if (edges.length) {
    const bar = document.createElement('div')
    bar.id = 'c4-flow-caption'
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', 'Flow')
    const play = button('c4-flow-play', '▶', 'Play the flow')
    const prev = button('c4-flow-prev', '◀', 'Previous flow')
    const next = button('c4-flow-next', '▶', 'Next flow')
    const replay = button('c4-flow-replay', '↻', 'Replay the flow')
    const word = document.createElement('span')
    word.className = 'c4-flow-word'
    word.setAttribute('aria-hidden', 'true')
    play.append(word)
    const text = document.createElement('p')
    text.id = 'c4-flow-text'
    text.setAttribute('aria-live', 'polite')
    text.setAttribute('aria-atomic', 'true')
    bar.append(play, prev, next, replay, text)
    document.body.append(bar)

    let index = 0
    let playing = false
    let raf = 0
    let timer = 0
    let dot = null
    let length = 0

    const atEnd = () => index === edges.length - 1

    function place(frac) {
      const edge = edges[index]
      if (!edge) return
      const point = edge.el.getPointAtLength(length * frac)
      if (!dot) {
        dot = document.createElementNS(NS, 'circle')
        dot.setAttribute('class', 'c4-dot')
        dot.setAttribute('r', '5')
        dot.setAttribute('pointer-events', 'none')
      }
      // one dot, always: re-added to the routes' own group so it shares their coordinates
      if (dot.parentNode !== rootG) rootG.append(dot)
      dot.setAttribute('cx', String(point.x))
      dot.setAttribute('cy', String(point.y))
    }

    function stop() {
      playing = false
      if (raf) cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
      raf = 0
      timer = 0
    }

    /** One edge's text: the caption, and the live region that is allowed to say it. */
    function say(edge) {
      const [from, to] = edge.key.split('->')
      text.setAttribute('aria-live', live(playing))
      text.textContent = caption(labelOf(from || ''), to ? labelOf(to) : '', edge.label, index, edges.length)
    }

    function paint() {
      const look = face(index, edges.length, playing)
      word.textContent = look.word
      play.querySelector('.c4-flow-icon').textContent = look.glyph
      play.setAttribute('aria-label', `${look.word} the flow`)
      play.dataset.state = look.state
      replay.setAttribute('aria-disabled', look.replay ? 'false' : 'true')
    }

    /** One step, drawn and nothing else: dot at the midpoint, caption, buttons. */
    function show(i) {
      stop()
      index = Math.max(0, Math.min(edges.length - 1, i))
      length = edges[index].el.getTotalLength()
      place(0.5)
      say(edges[index])
      paint()
    }

    /** One step of autoplay: travel, then hold; reduced motion jumps instead. */
    function begin(i) {
      index = i
      length = edges[index].el.getTotalLength()
      say(edges[index])
      const after = () => (atEnd() ? end() : begin(index + 1))
      if (reduce.matches) {
        place(0.5)
        timer = setTimeout(after, STEPPED)
        return
      }
      const start = performance.now()
      const tick = (now) => {
        const t = Math.min(1, (now - start) / TRAVEL)
        place(t)
        if (t < 1) {
          raf = requestAnimationFrame(tick)
          return
        }
        raf = 0
        timer = setTimeout(after, DWELL)
      }
      raf = requestAnimationFrame(tick)
    }

    function end() {
      stop()
      index = edges.length - 1
      length = edges[index].el.getTotalLength()
      place(1)
      say(edges[index])
      paint()
    }

    function start() {
      playing = true
      paint()
      begin(index)
    }

    function toggle() {
      if (playing) return show(index)
      if (atEnd()) index = 0
      start()
    }

    function step(dir) {
      show(Math.max(0, Math.min(edges.length - 1, index + dir)))
    }

    function replayNow() {
      index = 0
      start()
    }

    play.addEventListener('click', toggle)
    prev.addEventListener('click', () => step(-1))
    next.addEventListener('click', () => step(1))
    replay.addEventListener('click', () => {
      if (replay.getAttribute('aria-disabled') !== 'true') replayNow()
    })

    // clicking an edge jumps to its step
    for (const [i, edge] of edges.entries()) edge.el.addEventListener('click', () => show(i))

    // keys belong to the bar: a global Space or arrow steals page scroll from someone who
    // never asked for the animation (ux-guideline §4.3)
    bar.addEventListener('keydown', (e) => {
      const action = actionOf(e)
      if (!action) return
      if (action === 'toggle') toggle()
      else if (action === 'next') step(1)
      else if (action === 'prev') step(-1)
      else if (action === 'first') show(0)
      else if (action === 'last') show(edges.length - 1)
      else if (action === 'replay') replayNow()
      else if (action === 'stop') stop()
      e.preventDefault()
    })

    // first paint: paused on step 1, edge lit, caption filled, zero motion
    show(0)

    window.__c4 = window.__c4 || {}
    window.__c4.flow = {
      order: edges.map((e) => e.step),
      play: toggle,
      pause: () => show(index),
      step: (dir = 1) => step(dir),
      current: () => index,
      state: () => ({
        index,
        total: edges.length,
        playing,
        live: text.getAttribute('aria-live'),
        caption: text.textContent,
        button: play.dataset.state,
        replay: replay.getAttribute('aria-disabled'),
      }),
    }
  }
}

/* c4-view flow — the linear narration: exactly one dot, one edge at a time, in
 * the emitter's data-flow order. Loaded after viewer.js; reads the same drawing. */
(() => {
  'use strict'

  const stage = document.getElementById('c4-stage')
  const svg = stage && stage.querySelector('svg')
  const rootG = svg && (svg.querySelector('g.c4-root') || svg.querySelector('g'))
  if (!rootG) return

  const NS = 'http://www.w3.org/2000/svg'
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  const domPaths = [...svg.querySelectorAll('path[data-flow]')]

  // a chip carries its edge key now; the positional pairing stays as the fallback
  // for an older exported svg
  const chipEls = [...svg.querySelectorAll('g[data-chip]')]
  const byKey = new Map(chipEls.filter((g) => g.dataset.key).map((g) => [g.dataset.key, g.textContent.trim()]))
  const positional = chipEls.length === domPaths.length
    ? new Map(domPaths.map((el, i) => [el.dataset.key, chipEls[i].textContent.trim()]))
    : new Map()
  const labels = new Map(domPaths.map((el) => [el, byKey.get(el.dataset.key) ?? positional.get(el.dataset.key) ?? '']))

  const edges = domPaths
    .map((el) => ({ el, step: Number(el.dataset.flow), key: el.dataset.key || '', label: labels.get(el) || '' }))
    .filter((e) => Number.isFinite(e.step))
    .sort((a, b) => a.step - b.step)
  if (!edges.length) return

  const bar = document.createElement('div')
  bar.id = 'c4-flow-caption'
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'c4-flow-play'
  button.textContent = '▶'
  button.setAttribute('aria-label', 'Play or pause the flow')
  const text = document.createElement('span')
  text.id = 'c4-flow-text'
  bar.append(button, text)
  document.body.append(bar)

  let index = -1
  let playing = false
  let done = false
  let elapsed = 0
  let startAt = 0
  let length = 0
  let duration = 0
  let raf = 0
  let dot = null

  const caption = (msg) => {
    text.textContent = msg
  }

  function place(frac) {
    const edge = edges[index]
    if (!edge) return
    const p = edge.el.getPointAtLength(length * frac)
    if (!dot) {
      dot = document.createElementNS(NS, 'circle')
      dot.setAttribute('class', 'c4-dot')
      dot.setAttribute('r', '5')
      dot.setAttribute('pointer-events', 'none')
    }
    // one dot, always: re-added to the routes' own group so it shares their coordinates
    if (dot.parentNode !== rootG) rootG.append(dot)
    dot.setAttribute('cx', String(p.x))
    dot.setAttribute('cy', String(p.y))
  }

  function hideDot() {
    if (dot && dot.parentNode) dot.remove()
  }

  function describe(edge) {
    const [from, to] = edge.key.split('->')
    const label = edge.label ? ` · ${edge.label}` : ''
    return `${from || edge.key} → ${to || ''}${label} · ${index + 1} / ${edges.length}`
  }

  function measure(edge) {
    length = edge.el.getTotalLength()
    duration = Math.min(2000, Math.max(400, (length / 120) * 1000))
  }

  function begin(i, resume = 0) {
    index = i
    done = false
    measure(edges[i])
    elapsed = resume
    startAt = performance.now() - resume
    caption(describe(edges[i]))
    if (reduce.matches) {
      playing = false
      button.textContent = '▶'
      place(0.5)
      return
    }
    playing = true
    button.textContent = '⏸'
    place(duration ? Math.min(1, resume / duration) : 0)
    raf = requestAnimationFrame(tick)
  }

  function tick(now) {
    elapsed = now - startAt
    const t = duration > 0 ? Math.min(1, elapsed / duration) : 1
    place(t)
    if (t < 1) {
      raf = requestAnimationFrame(tick)
      return
    }
    raf = 0
    if (index < edges.length - 1) begin(index + 1)
    else finish()
  }

  function finish() {
    playing = false
    done = true
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    hideDot()
    button.textContent = '▶'
    caption(`replay · ${edges.length} / ${edges.length}`)
  }

  function pause() {
    if (!playing) return
    playing = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    elapsed = performance.now() - startAt
    button.textContent = '▶'
    if (index >= 0) place(duration ? Math.min(1, elapsed / duration) : 1)
  }

  function play() {
    if (playing) return
    if (done) return begin(0)
    if (index < 0) return begin(0)
    begin(index, elapsed >= duration ? 0 : elapsed)
  }

  /** Paused view of one edge: dot at its midpoint, caption up to date. */
  function show(i) {
    playing = false
    done = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    index = i
    measure(edges[i])
    elapsed = duration / 2
    button.textContent = '▶'
    caption(describe(edges[i]))
    place(0.5)
  }

  function step(dir = 1) {
    pause()
    const next = Math.max(0, index + dir)
    if (next >= edges.length) return finish()
    show(next)
  }

  button.addEventListener('click', () => (playing ? pause() : play()))

  for (const [i, edge] of edges.entries()) {
    edge.el.addEventListener('click', () => {
      pause()
      show(i)
    })
  }

  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      if (playing) pause()
      else play()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      step(-1)
    }
  })

  caption(`flow · ${edges.length} edges · press play`)
  window.__c4 = window.__c4 || {}
  window.__c4.flow = {
    order: edges.map((e) => e.step),
    play,
    pause,
    step,
    current: () => index,
  }
})()

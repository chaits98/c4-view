/* c4-view viewer — read-only: fit, pan, zoom, hover, drill, legend.
 * Contract: docs/HTTP-API.md "Viewer". No build step, no dependency.
 * Node markup read: g[data-id][data-kind][data-desc][data-drill], root g.c4-root. */
(() => {
  'use strict'

  const stage = document.getElementById('c4-stage')
  const svg = stage && stage.querySelector('svg')
  if (!stage || !svg) return
  const rootG = svg.querySelector('g.c4-root') || svg.querySelector('g')
  if (!rootG) return

  // The emitter's own root transform stays the tail of ours, so a node's
  // coordinates remain the emitter's (model) coordinates.
  const BASE = rootG.getAttribute('transform') || ''
  // its own matrix only (no viewBox/viewport scale — that one is the svg's).
  // ponytail: emitted roots are translate(+scale) only; a rotated root would
  // need the four bbox corners instead of this axis-wise mapping.
  const own = rootG.transform.baseVal.consolidate()
  const M0 = own ? own.matrix : new DOMMatrix()

  const card = document.getElementById('c4-hover')
  const levels = document.getElementById('c4-levels')
  const legend = document.getElementById('c4-legend')

  let k = 1
  let x = 0
  let y = 0
  let drag = null

  const cardTitle = document.createElement('div')
  const cardDesc = document.createElement('div')
  cardTitle.className = 'c4-hover-title'
  cardDesc.className = 'c4-hover-desc'
  if (card) card.append(cardTitle, cardDesc)

  const round = (v, p = 2) => Number(v.toFixed(p))
  const view = () => ({ k, x, y })
  const root = () => document.body.dataset.root || location.pathname.replace(/\/+$/, '')

  /** The stage's box in the svg's user units, and the user→css scale. */
  function visible() {
    const cw = svg.clientWidth
    const ch = svg.clientHeight
    const m = svg.getScreenCTM()
    const s = m && Math.abs(m.a) > 0 ? Math.abs(m.a) : 1
    if (!m || !(cw > 0 && ch > 0)) return { x: 0, y: 0, w: 0, h: 0, s }
    const a = new DOMPoint(0, 0).matrixTransform(m.inverse())
    const b = new DOMPoint(cw, ch).matrixTransform(m.inverse())
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: cw / s, h: ch / s, s }
  }

  /** The drawing's bounds in viewBox units, the emitter's base transform applied. */
  function drawingBox() {
    const b = rootG.getBBox()
    return { x: M0.a * b.x + M0.e, y: M0.d * b.y + M0.f, w: b.width * M0.a, h: b.height * M0.d }
  }

  function screenToUser(cx, cy) {
    const m = svg.getScreenCTM()
    return m ? new DOMPoint(cx, cy).matrixTransform(m.inverse()) : null
  }

  function apply() {
    rootG.setAttribute('transform', `translate(${round(x)} ${round(y)}) scale(${round(k, 4)})${BASE ? ` ${BASE}` : ''}`)
  }

  function fit() {
    const v = visible()
    const b = drawingBox()
    if (!(v.w > 0 && v.h > 0 && b.w > 0 && b.h > 0)) return view()
    const pad = 24 / v.s // 24 css px, in user units
    k = Math.min((v.w - pad * 2) / b.w, (v.h - pad * 2) / b.h)
    if (!(k > 0)) k = 1
    // no 0.3 floor here: rule 1 is "whole drawing visible", the clamp is for zoom
    x = v.x + (v.w - b.w * k) / 2 - b.x * k
    y = v.y + (v.h - b.h * k) / 2 - b.y * k
    apply()
    return view()
  }

  function zoomAt(cx, cy, factor) {
    const u = screenToUser(cx, cy)
    if (!u) return view()
    const next = Math.min(3, Math.max(0.3, k * factor))
    if (next === k) return view()
    x = u.x - (u.x - x) * (next / k)
    y = u.y - (u.y - y) * (next / k)
    k = next
    apply()
    return view()
  }

  /** Screen point → emitter coordinates. */
  function toWorld(cx, cy) {
    const u = screenToUser(cx, cy)
    return u ? { x: (u.x - x) / k, y: (u.y - y) / k } : null
  }

  function drillUrl(node) {
    const d = node && node.dataset && node.dataset.drill
    return d ? `${root()}/${d}` : null
  }

  /** The node's label lines: the largest-font text of the node (identity/tech are smaller). */
  function labelOf(node) {
    const texts = [...node.querySelectorAll('text')]
    if (!texts.length) return node.dataset.id || ''
    const big = Math.max(...texts.map((t) => parseFloat(t.getAttribute('font-size')) || 0))
    return texts
      .filter((t) => (parseFloat(t.getAttribute('font-size')) || 0) === big)
      .map((t) => t.textContent.trim())
      .join(' ')
  }

  function hideHover() {
    if (card && !card.hidden) card.hidden = true
  }

  function showHover(node, cx, cy) {
    if (!card) return
    cardTitle.textContent = labelOf(node)
    cardDesc.textContent = node.dataset.desc || ''
    card.hidden = false
    card.style.left = `${Math.max(8, Math.min(cx + 16, innerWidth - card.offsetWidth - 8))}px`
    card.style.top = `${Math.max(8, Math.min(cy + 18, innerHeight - card.offsetHeight - 8))}px`
  }

  function onHover(e) {
    const node = e.target.closest ? e.target.closest('g[data-id]') : null
    if (!node || !node.dataset.desc) return hideHover()
    showHover(node, e.clientX, e.clientY)
  }

  function buildLegend() {
    if (!legend) return
    const seen = new Map()
    for (const node of svg.querySelectorAll('g[data-id]')) {
      const kind = node.dataset.kind
      if (!kind || seen.has(kind)) continue
      const shape = node.firstElementChild
      seen.set(kind, (shape && shape.getAttribute('fill')) || 'currentColor')
    }
    legend.replaceChildren(
      ...[...seen].map(([kind, fill]) => {
        const item = document.createElement('span')
        item.className = 'c4-sw'
        const dot = document.createElement('i')
        dot.style.background = fill
        const name = document.createElement('span')
        name.textContent = kind
        item.append(dot, name)
        return item
      }),
    )
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const u = screenToUser(e.clientX, e.clientY)
    if (!u) return
    hideHover()
    drag = {
      id: e.pointerId,
      u,
      x0: e.clientX,
      y0: e.clientY,
      vx: x,
      vy: y,
      moved: 0,
      node: e.target.closest ? e.target.closest('g[data-id]') : null,
    }
    // capture retargets every later pointer event to the stage, so the node is
    // remembered here for the click-through; synthetic ids have nothing to capture
    try {
      stage.setPointerCapture(e.pointerId)
    } catch {
      /* no active pointer (headless probe) */
    }
    stage.classList.add('is-panning')
  })

  stage.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0))
      const u = screenToUser(e.clientX, e.clientY)
      if (!u) return
      x = drag.vx + (u.x - drag.u.x)
      y = drag.vy + (u.y - drag.u.y)
      apply()
      return
    }
    onHover(e)
  })

  stage.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const done = drag
    drag = null
    stage.classList.remove('is-panning')
    try {
      stage.releasePointerCapture(e.pointerId)
    } catch {
      /* never captured */
    }
    if (done.moved < 4) {
      const url = drillUrl(done.node)
      if (url) location.href = url
    }
  })

  stage.addEventListener('pointercancel', () => {
    drag = null
    stage.classList.remove('is-panning')
  })

  stage.addEventListener('pointerleave', hideHover)

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      hideHover()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.002))
    },
    { passive: false },
  )

  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const box = svg.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    if (e.key === '+' || e.key === '=') zoomAt(cx, cy, 1.2)
    else if (e.key === '-' || e.key === '_') zoomAt(cx, cy, 1 / 1.2)
    else if (e.key === '0') fit()
    else return
    e.preventDefault()
  })

  if (levels) {
    levels.addEventListener('change', () => {
      location.href = levels.value ? `${root()}/${levels.value}` : root()
    })
  }

  window.__c4 = { fit, zoomAt, toWorld, view, drillUrl }

  const init = () => {
    buildLegend()
    fit()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()

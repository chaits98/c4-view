/* c4-view viewer — read-only: zoom, scroll, hover, drill, legend.
 * Contract: docs/HTTP-API.md "Viewer". No build step, no dependency.
 * Node markup read: g[data-id][data-kind][data-desc][data-drill], root g.c4-root.
 *
 * Pan is native scrolling and zoom is a class on the scroll container (see viewer.css), so
 * the server renders the reading size from ?zoom= before first paint, arrow keys pan for
 * free, plain wheel scrolls the page instead of hijacking it, and touch pan works. */
(() => {
  'use strict'

  const stage = document.getElementById('c4-stage')
  const svg = stage && stage.querySelector('svg')
  if (!stage || !svg) return
  const rootG = svg.querySelector('g.c4-root') || svg.querySelector('g')
  if (!rootG) return

  /** Mirrors LADDER in src/viewer-page.ts: one class per step, Fit first. */
  const LADDER = ['fit', 0.5, 0.75, 1, 1.25, 1.5, 2, 3]
  const classOf = (step) => (step === 'fit' ? 'zoom-fit' : `zoom-${Math.round(step * 100)}`)
  const labelOf = (step) => (step === 'fit' ? 'Fit' : `${Math.round(step * 100)}%`)

  const card = document.getElementById('c4-hover')
  const levels = document.getElementById('c4-levels')
  const legend = document.getElementById('c4-legend')
  const zoomBar = document.getElementById('c4-zoom')
  const readout = document.getElementById('c4-zoom-readout')
  const presets = [...(zoomBar ? zoomBar.querySelectorAll('[data-zoom]') : [])]

  const cardTitle = document.createElement('div')
  const cardDesc = document.createElement('div')
  cardTitle.className = 'c4-hover-title'
  cardDesc.className = 'c4-hover-desc'
  if (card) card.append(cardTitle, cardDesc)

  const root = () => document.body.dataset.root || location.pathname.replace(/\/+$/, '')

  /** Where on the drawing the canvas is currently looking, 0–1 per axis. */
  function focusOf() {
    const fx = stage.scrollWidth > stage.clientWidth ? (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth : 0.5
    const fy = stage.scrollHeight > stage.clientHeight ? (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight : 0.5
    return { fx, fy }
  }

  /** The step the page is showing, from the class the server rendered. */
  function current() {
    const on = [...stage.classList].find((name) => name.startsWith('zoom-'))
    const at = LADDER.findIndex((step) => classOf(step) === on)
    return at < 0 ? 0 : at
  }

  /** Swap the step, keep the reading position under the middle of the canvas, keep the URL true. */
  function setZoom(at) {
    const next = Math.max(0, Math.min(LADDER.length - 1, at))
    const step = LADDER[next]
    const { fx, fy } = focusOf()
    for (const other of LADDER) stage.classList.toggle(classOf(other), classOf(other) === classOf(step))
    stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2
    stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2
    if (readout) readout.textContent = labelOf(step)
    for (const link of presets) {
      if (link.dataset.zoom === String(step)) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    }
    // replaceState, not pushState: the zoom is a view parameter, and Back should still
    // take the reader to the grid instead of back through five zoom levels
    const url = new URL(location.href)
    if (step === 'fit') url.searchParams.delete('zoom')
    else url.searchParams.set('zoom', String(step))
    history.replaceState(null, '', url)
  }

  function hideHover() {
    if (card && !card.hidden) card.hidden = true
  }

  /** The node's label lines: the largest-font text of the node (identity/tech are smaller). */
  function labelOfNode(node) {
    const texts = [...node.querySelectorAll('text')]
    if (!texts.length) return node.dataset.id || ''
    const big = Math.max(...texts.map((t) => parseFloat(t.getAttribute('font-size')) || 0))
    return texts
      .filter((t) => (parseFloat(t.getAttribute('font-size')) || 0) === big)
      .map((t) => t.textContent.trim())
      .join(' ')
  }

  // The authored doc for this node, when the repo has one; the model's one-line desc otherwise.
  function docFor(node) {
    const docs = docPayload()
    const html = docs && docs.nodes ? docs.nodes[node.dataset.id] : undefined
    return html || ''
  }

  // Place beside the node, never on top of it: the card explains the node, so hiding it defeats the
  // point. Right first, left when the right edge would overflow, always clamped to the viewport.
  function placeCard(node) {
    const box = node.getBoundingClientRect()
    const gap = 12
    const width = card.offsetWidth
    const height = card.offsetHeight
    const right = box.right + gap
    const left = right + width > innerWidth - 8 ? box.left - width - gap : right
    card.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`
    card.style.top = `${Math.max(8, Math.min(box.top + box.height / 2 - height / 2, innerHeight - height - 8))}px`
  }

  function showHover(node) {
    if (!card) return
    cardTitle.textContent = labelOfNode(node)
    const html = docFor(node)
    if (html) cardDesc.innerHTML = html
    else cardDesc.textContent = node.dataset.desc || ''
    card.hidden = false
    placeCard(node)
  }

  function onHover(e) {
    const node = e.target.closest ? e.target.closest('g[data-id]') : null
    if (!node || (!node.dataset.desc && !docFor(node))) return hideHover()
    showHover(node)
  }

  /** The server embeds every doc for this level as one JSON block; parse it once, lazily. */
  let docsCache
  function docPayload() {
    if (docsCache !== undefined) return docsCache
    const el = document.getElementById('c4-docs')
    docsCache = null
    if (el) {
      try {
        docsCache = JSON.parse(el.textContent || '{}')
      } catch {
        docsCache = null
      }
    }
    return docsCache
  }

  const KIND_NAMES = { concept: 'concept', step: 'inside one component', tool: 'infrastructure' }

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
        name.textContent = KIND_NAMES[kind] ?? kind
        item.append(dot, name)
        return item
      }),
    )
  }

  stage.addEventListener('pointermove', onHover)
  stage.addEventListener('pointerleave', hideHover)
  stage.addEventListener('scroll', hideHover, { passive: true })

  // The SVG carries real <a href> links for drills when the server rendered the page, so the
  // browser already handles click, middle-click and Back. This handler only covers an SVG that
  // arrived without links (a pasted export), and never fights a real anchor.
  stage.addEventListener('click', (e) => {
    const node = e.target.closest ? e.target.closest('g[data-id]') : null
    if (!node || node.closest('a')) return
    const drill = node.dataset && node.dataset.drill
    if (drill) location.href = `${root()}/${drill}`
  })

  if (zoomBar) {
    zoomBar.addEventListener('click', (e) => {
      const button = e.target.closest ? e.target.closest('[data-step], [data-zoom]') : null
      if (!button) return
      // a modified click on a preset is the browser's (new tab, new window) — leave it alone
      if (button.dataset.zoom && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return
      e.preventDefault()
      const step = button.dataset.zoom
      setZoom(step ? LADDER.indexOf(step === 'fit' ? 'fit' : Number(step)) : current() + Number(button.dataset.step))
    })
  }

  // zoom keys are scoped to the canvas, and browser zoom keeps its own shortcuts
  stage.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '+' || e.key === '=') setZoom(current() + 1)
    else if (e.key === '-' || e.key === '_') setZoom(current() - 1)
    else if (e.key === '0') setZoom(0)
    else return
    e.preventDefault()
  })

  if (levels) {
    levels.addEventListener('change', () => {
      // a level change is a full navigation and starts at Fit: the drawing has a new shape
      location.href = levels.value ? `${root()}/${levels.value}` : root()
    })
  }

  // flow.js captions name the nodes, so the label reading is shared rather than copied
  window.__c4 = { zoom: () => LADDER[current()], setZoom: (step) => setZoom(LADDER.indexOf(step)), labelOf: labelOfNode }

  buildLegend()
})()

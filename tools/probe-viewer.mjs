#!/usr/bin/env node
/**
 * `node tools/probe-viewer.mjs` — proves the viewer behaviours in public/viewer.js.
 *
 * Boots a throwaway static server over the repo, loads public/fixture.html in
 * headless chromium (--dump-dom), reads the JSON report the fixture's own script
 * writes into <pre id="probe">, and asserts it here. Exit 1 + the report on any
 * failed assertion.
 */
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = new URL('..', import.meta.url).pathname
const CHROME = process.env.CHROME || '/usr/bin/chromium'
const SERVE = new Set(['/public/fixture.html', '/public/viewer.js', '/public/viewer.css', '/public/viewer.html', '/public/flow.js'])
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (!SERVE.has(path)) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not served by the probe\n')
      return
    }
    try {
      const body = await readFile(join(ROOT, path))
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' })
      res.end(body)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String(err))
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function dump(url, profile) {
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1280,900',
    '--virtual-time-budget=8000',
    `--user-data-dir=${profile}`,
    '--dump-dom',
    url,
  ]
  return new Promise((resolve, reject) => {
    execFile(CHROME, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout),
    )
  })
}

function reportOf(dom) {
  const m = dom.match(/<pre id="probe"[^>]*>([\s\S]*?)<\/pre>/)
  if (!m) return null
  const text = m[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  return JSON.parse(text)
}

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass, detail })
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

async function main() {
  if (!existsSync(CHROME)) throw new Error(`chromium not found at ${CHROME} (set CHROME=)`)
  const server = await serve()
  const { port } = server.address()
  const profile = join(tmpdir(), `c4-view-probe-${process.pid}`)
  mkdirSync(profile, { recursive: true })
  let dom
  try {
    dom = await dump(`http://127.0.0.1:${port}/public/fixture.html`, profile)
  } finally {
    server.close()
    rmSync(profile, { recursive: true, force: true })
  }

  const report = reportOf(dom)
  if (!report) {
    console.error('probe FAILED — no <pre id="probe"> report in the dumped DOM')
    console.error(dom.slice(0, 4000))
    process.exit(1)
  }
  const { facts, errors } = report
  const f = facts || {}

  if (errors && errors.length) check('fixture script', false, errors.join(' | '))
  else check('fixture script', true, 'ran without throwing')

  check(
    'fit() produced a finite transform',
    Boolean(f.fitFinite && /^translate\((-?[\d.]+) (-?[\d.]+)\) scale\([\d.]+\)/.test(f.transform || '')),
    `transform="${f.transform}" k=${f.fit && f.fit.k}`,
  )
  const bounds = f.bounds || { pad: {} }
  const pads = Object.values(bounds.pad || {})
  check(
    'fit() leaves the whole drawing inside the stage with 24px padding',
    pads.length === 4 && pads.every((p) => p >= 23.5) && Math.min(...pads) <= 30,
    `pad=${JSON.stringify(bounds.pad)} stage=${JSON.stringify(bounds.stage)} drawing=${JSON.stringify(bounds.drawing)}`,
  )
  check(
    'wheel changed the scale',
    Number.isFinite(f.wheelBefore) && Number.isFinite(f.wheelAfter) && f.wheelAfter > f.wheelBefore,
    `k ${f.wheelBefore} → ${f.wheelAfter}`,
  )
  const drag = f.drag || { before: {}, after: {} }
  check(
    'pointer drag changed the translate',
    Number.isFinite(drag.before.x) && (Math.abs(drag.after.x - drag.before.x) > 1 || Math.abs(drag.after.y - drag.before.y) > 1),
    `(${drag.before.x}, ${drag.before.y}) → (${drag.after.x}, ${drag.after.y})`,
  )
  const hover = f.hover || {}
  check(
    'hovering a node with data-desc un-hides #c4-hover',
    hover.hidden === false && Boolean(hover.label),
    `node=${hover.node} hidden=${hover.hidden} label="${hover.label}"`,
  )
  check(
    '#c4-hover contains the description text',
    typeof hover.desc === 'string' && hover.desc === hover.expectedDesc && String(hover.text).includes(hover.expectedDesc),
    `desc="${hover.desc}"`,
  )
  const hv = f.hoverView || { before: {}, after: {} }
  check(
    'hovering never moves the view',
    Boolean(hv.before && hv.after) && hv.before.k === hv.after.k && hv.before.x === hv.after.x && hv.before.y === hv.after.y,
    `view ${JSON.stringify(hv.before)} → ${JSON.stringify(hv.after)}`,
  )
  check(
    'zoom is clamped to 0.3–3',
    f.clamp && f.clamp.max === 3 && f.clamp.min === 0.3,
    `max=${f.clamp && f.clamp.max} min=${f.clamp && f.clamp.min}`,
  )
  const drill = f.drill || {}
  check(
    'drillUrl(node) === data-root + "/" + data-drill',
    Boolean(drill.drill) && drill.url === `${drill.root}/${drill.drill}` && drill.url === drill.expected,
    `drillUrl=${drill.url} expected=${drill.expected}`,
  )
  const legend = f.legend || { kinds: [] }
  check(
    'legend has one swatch per kind',
    legend.kinds.length > 0 && legend.swatches === legend.kinds.length,
    `kinds=${legend.kinds.join(',')} swatches=${legend.swatches} fills=${(legend.fills || []).join(',')}`,
  )
  check(
    'two fits in a row are idempotent',
    Boolean(f.fit && f.fit2) && near(f.fit.k, f.fit2.k) && near(f.fit.x, f.fit2.x) && near(f.fit.y, f.fit2.y),
    `1st=${JSON.stringify(f.fit)} 2nd=${JSON.stringify(f.fit2)}`,
  )
  check(
    'window.__c4 exposes fit, zoomAt, toWorld, view, drillUrl',
    ['drillUrl', 'fit', 'toWorld', 'view', 'zoomAt'].every((k) => (f.viewApi || []).includes(k)),
    `keys=${(f.viewApi || []).join(',')}`,
  )

  const order = Array.isArray(f.flowOrder) ? f.flowOrder : []
  check(
    'flow order has one entry per path[data-flow], sorted 1..n',
    order.length > 0 && order.length === f.flowPaths && order.every((v, i) => v === i + 1),
    `order=[${order.join(',')}] paths=${f.flowPaths}`,
  )
  const fp = f.flowPlaying || {}
  check(
    'play() leaves exactly one dot and a caption with an arrow',
    fp.dots === 1 && typeof fp.caption === 'string' && fp.caption.includes('→'),
    `dots=${fp.dots} caption="${fp.caption}"`,
  )
  const fs = f.flowStep || {}
  check(
    'step(1) while paused advances one edge and keeps one dot',
    fs.to === fs.from + 1 && fs.dots === 1,
    `current ${fs.from} → ${fs.to}, dots=${fs.dots}, caption="${fs.caption}"`,
  )
  const fe = f.flowEnd || {}
  check(
    'after the last edge the dot is gone and the caption says replay',
    fe.dots === 0 && /replay/i.test(String(fe.caption)),
    `dots=${fe.dots} caption="${fe.caption}" current=${fe.current}`,
  )
  const fsp = f.flowSpace || { before: {}, after: {} }
  check(
    'Space twice returns to the same playing state',
    Boolean(fsp.before.play) && fsp.before.play === fsp.after.play && fsp.after.dots <= 1,
    `play=${fsp.before.play}→${fsp.after.play} dots ${fsp.before.dots}→${fsp.after.dots}`,
  )

  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name} — ${c.detail}`)
  const failed = checks.filter((c) => !c.pass)
  if (failed.length) {
    console.error(`\nprobe FAILED — ${failed.length}/${checks.length} assertion(s) failed; report:`)
    console.error(JSON.stringify(report, null, 2))
    process.exit(1)
  }
  console.log(`\nprobe OK — ${checks.length}/${checks.length} assertions`)
}

main().catch((err) => {
  console.error(`probe ERROR — ${err && err.message ? err.message : err}`)
  if (err && err.stderr) console.error(String(err.stderr).slice(0, 2000))
  process.exit(1)
})

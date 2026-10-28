/** HTTP surface: `/` is the grid, `/d/<id>` one diagram; a bad id or level segment is a 404. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelError, levelOrder, parseModel } from './model.ts'
import { indexEntries, indexPage } from './index-page.ts'
import { renderModel } from './render.ts'
import { svgToPng } from './png.ts'
import { levelSlug } from './slug.ts'
import type { Model } from './types.ts'

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MAX_BODY = 2 * 1024 * 1024
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
type Route =
  | { kind: 'health' | 'diagrams' | 'index' }
  | { kind: 'model' | 'audit'; id: string }
  | { kind: 'page'; id: string; level: string }
  | { kind: 'export'; format: 'svg' | 'png'; id: string }
  | { kind: 'asset'; name: string }

type Summary = { id: string; title: string; levels: string[]; updated: string }

/** Bind and resolve once listening, so a test can pass port 0. */
export async function serve(opts: { port: number; root: string; host?: string }): Promise<Server> {
  const root = resolve(opts.root)
  const server = createServer((req, res) => {
    const started = Date.now()
    const pathname = safePath(req.url ?? '/')
    res.on('finish', () => console.log(`${req.method} ${pathname ?? req.url} ${res.statusCode} ${Date.now() - started}ms`))
    void handle(root, req, res, pathname).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (res.headersSent) res.destroy()
      else json(res, 500, { error: message })
    })
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      server.off('error', fail)
      done()
    })
  })
  return server
}

/** Decoded pathname, or null when the percent-encoding is broken. */
function safePath(raw: string): string | null {
  try {
    return decodeURIComponent(new URL(raw, 'http://localhost').pathname)
  } catch {
    return null
  }
}

function routeOf(pathname: string): Route | null {
  if (pathname === '/') return { kind: 'index' }
  if (pathname === '/health') return { kind: 'health' }
  if (pathname === '/api/diagrams' || pathname === '/api/diagrams/') return { kind: 'diagrams' }
  const asset = /^\/([a-z0-9][a-z0-9-]*\.(?:js|css))$/.exec(pathname)
  if (asset) return { kind: 'asset', name: asset[1] }

  const api = /^\/api\/diagrams\/([^/]+)(\/audit)?$/.exec(pathname)
  if (api) {
    if (!ID.test(api[1])) return null
    return { kind: api[2] ? 'audit' : 'model', id: api[1] }
  }
  if (!pathname.startsWith('/d/')) return null

  const rest = pathname.slice(3)
  const exported = /^([^/]+)\.(svg|png)$/.exec(rest)
  if (exported) {
    if (!ID.test(exported[1])) return null
    return { kind: 'export', format: exported[2] === 'svg' ? 'svg' : 'png', id: exported[1] }
  }
  const segments = rest.split('/')
  const id = segments.shift() ?? ''
  if (!ID.test(id)) return null
  const level = segments.join('/')
  if (level !== '' && !validLevel(level)) return null
  return { kind: 'page', id, level }
}

/** A level path: '' or segments that each match ID (so no `..`, no absolute paths). */
function validLevel(path: string): boolean {
  return path === '' || path.split('/').every((segment) => ID.test(segment))
}

async function handle(root: string, req: IncomingMessage, res: ServerResponse, pathname: string | null): Promise<void> {
  if (pathname === null) return json(res, 404, { error: 'malformed path' })
  const route = routeOf(pathname)
  if (!route) return json(res, 404, { error: `no route for ${pathname}` })

  const method = req.method ?? 'GET'
  const allow = route.kind === 'diagrams' ? 'GET, POST' : 'GET'
  if (!allow.split(', ').includes(method)) {
    res.setHeader('Allow', allow)
    return json(res, 405, { error: `${method} is not allowed here` })
  }
  const query = new URL(req.url ?? '/', 'http://localhost')

  switch (route.kind) {
    case 'index':
      return send(res, 200, 'text/html; charset=utf-8', indexPage(indexEntries(list(root), (id) => loadModel(root, id))))
    case 'health':
      return json(res, 200, { ok: true, diagrams: list(root).length })
    case 'diagrams':
      return method === 'POST' ? create(root, req, res) : json(res, 200, list(root))
    case 'model': {
      const file = modelFile(root, route.id)
      if (!existsSync(file)) return missing(res, route.id)
      return send(res, 200, 'application/json; charset=utf-8', readFileSync(file))
    }
    case 'audit': {
      const model = loadModel(root, route.id)
      if (!model) return missing(res, route.id)
      const level = query.searchParams.get('level')
      if (level === null) return json(res, 200, renderModel(model).levels.map((l) => l.audit))
      if (!findLevel(model, level)) return noLevel(res, level, model)
      return json(res, 200, renderModel(model, level).levels[0].audit)
    }
    case 'page': {
      const model = loadModel(root, route.id)
      if (!model) return missing(res, route.id)
      if (!findLevel(model, route.level)) return noLevel(res, route.level, model)
      return send(res, 200, 'text/html; charset=utf-8', viewerPage(model, route.level))
    }
    case 'export': {
      const model = loadModel(root, route.id)
      if (!model) return missing(res, route.id)
      const level = query.searchParams.get('level') ?? ''
      if (!findLevel(model, level)) return noLevel(res, level, model)
      if (route.format === 'svg') return send(res, 200, 'image/svg+xml; charset=utf-8', renderModel(model, level).levels[0].svg)
      return send(res, 200, 'image/png', readFileSync(pngFor(root, model, level)))
    }
    case 'asset': {
      const file = join(PUBLIC, route.name)
      if (!existsSync(file)) return send(res, 404, 'text/plain; charset=utf-8', `${route.name} is not installed yet`)
      return send(res, 200, route.name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', readFileSync(file))
    }
  }
}

const modelFile = (root: string, id: string): string => join(root, id, 'model.json')

/** Write `.tmp` then rename: a reader never sees half a model. */
function save(root: string, id: string, raw: string): void {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.model.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
  writeFileSync(tmp, raw)
  renameSync(tmp, modelFile(root, id))
}

function loadModel(root: string, id: string): Model | null {
  const file = modelFile(root, id)
  return existsSync(file) ? parseModel(JSON.parse(readFileSync(file, 'utf8'))) : null
}

function list(root: string): Summary[] {
  if (!existsSync(root)) return []
  const out: Summary[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = modelFile(root, entry.name)
    if (!entry.isDirectory() || !ID.test(entry.name) || !existsSync(file)) continue
    try {
      const model = parseModel(JSON.parse(readFileSync(file, 'utf8')))
      out.push({ id: entry.name, title: model.title, levels: levelOrder(model).map((l) => l.path), updated: new Date(statSync(file).mtimeMs).toISOString() })
    } catch {
      // a corrupt or half-written file must not take the listing down
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
function findLevel(model: Model, path: string) {
  return validLevel(path) ? model.levels.find((level) => level.path === path) : undefined
}

/** One cached png per level path — `levelSlug` is injective, so `a/b` and `a-b` never share. */
function pngFor(root: string, model: Model, level: string): string {
  const out = join(root, model.id, 'out', `${levelSlug(level)}.png`)
  const source = modelFile(root, model.id)
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(source).mtimeMs) return out
  return svgToPng(renderModel(model, level).levels[0].svg, out)
}

async function create(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req, res)
  if (raw === null) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return json(res, 400, { problems: ['body: not valid JSON'] })
  }
  let model: Model
  try {
    model = parseModel(parsed)
  } catch (error) {
    if (error instanceof ModelError) return json(res, 400, { problems: error.problems })
    throw error
  }
  save(root, model.id, raw)
  const rendered = renderModel(model)
  return json(res, 201, { id: model.id, url: `/d/${model.id}`, audit: rendered.levels.map((l) => l.audit) })
}

/** The body as text, or null once a 413 has been answered and the socket closed. */
function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  return new Promise((done) => {
    let settled = false
    let size = 0
    const chunks: Buffer[] = []
    const stop = (): void => {
      if (settled) return
      settled = true
      res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' })
      res.end('body exceeds 2 MB', () => req.destroy())
      done(null)
    }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BODY) return stop()
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY) return stop()
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      done(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', () => {
      if (settled) return
      settled = true
      done(null)
    })
  })
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Every untrusted string in the page goes through this; the svg is already escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] as string)
}

function viewerPage(model: Model, level: string): string {
  const drawn = renderModel(model, level).levels[0]
  const levels = levelOrder(model)
  const root = `/d/${model.id}`
  const crumbs = [`<a href="/">all</a>`, `<a href="${esc(root)}">${esc(model.id)}</a>`]
  let at = ''
  for (const segment of level ? level.split('/') : []) {
    at = at ? `${at}/${segment}` : segment
    const found = findLevel(model, at)
    if (!found) continue
    const title = esc(found.title ?? found.path)
    crumbs.push(at === level ? `<span>${title}</span>` : `<a href="${esc(`${root}/${at}`)}">${title}</a>`)
  }
  if (level === '') crumbs.push(`<span>${esc(findLevel(model, '')?.title ?? 'Overview')}</span>`)
  const options = levels
    .map((l) => `<option value="${esc(l.path)}"${l.path === level ? ' selected' : ''}>${esc(l.title ?? l.path)}</option>`)
    .join('')

  // ONE template: public/viewer.html. A second, hardcoded copy in this file silently dropped
  // /flow.js from the page and the animation never ran (measured 2026-10-28).
  const template = readFileSync(join(PUBLIC, 'viewer.html'), 'utf8')
  return template
    .replace('<title>C4 viewer</title>', () => `<title>${esc(drawn.title)} — ${esc(model.title)}</title>`)
    .replace('<!--CRUMBS-->', () => crumbs.join(' / '))
    .replace('<!--LEVELS-->', () => options)
    .replace('<!--SVG-->', () => drawn.svg)
    .replace(
      ' data-diagram="" data-level="" data-root=""',
      () => ` data-diagram="${esc(model.id)}" data-level="${esc(level)}" data-root="${esc(root)}"`,
    )
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value))
}
function missing(res: ServerResponse, id: string): void {
  json(res, 404, { error: `no diagram "${id}"` })
}
function noLevel(res: ServerResponse, level: string, model: Model): void {
  json(res, 404, { error: `no level "${level}"`, levels: levelOrder(model).map((l) => l.path) })
}

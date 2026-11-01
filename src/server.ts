/** HTTP surface: `/` is the grid, `/d/<id>` one diagram; a bad id or level segment is a 404. */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelError, levelOf, levelOrder, parseModel } from './model.ts'
import { indexEntries, indexPage } from './index-page.ts'
import { renderModel } from './render.ts'
import { viewerPage } from './viewer-page.ts'
import { svgToPng } from './png.ts'
import { allowed, applyHeaders, guardFor, remember, type Guard } from './security.ts'
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
export async function serve(opts: { port: number; root: string; host?: string; token?: string }): Promise<Server & { guard: Guard }> {
  const root = resolve(opts.root)
  const host = opts.host ?? '127.0.0.1'
  const guard = guardFor(host, opts.token ?? process.env.C4_VIEW_TOKEN)
  const server = createServer((req, res) => {
    const started = Date.now()
    const pathname = safePath(req.url ?? '/')
    res.on('finish', () => console.log(`${req.method} ${pathname ?? req.url} ${res.statusCode} ${Date.now() - started}ms`))
    void handle(root, guard, req, res, pathname).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (res.headersSent) res.destroy()
      else json(res, 500, { error: message })
    })
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(opts.port, host, () => {
      server.off('error', fail)
      done()
    })
  })
  return Object.assign(server, { guard })
}

/** Decoded pathname, or null when the percent-encoding is broken. */
function safePath(raw: string): string | null {
  try {
    return decodeURIComponent(new URL(raw, 'http://localhost').pathname)
  } catch {
    return null
  }
}

/** `/`, `/health`, `/api/diagrams` and the public assets — no id, no level. */
function fixedRoute(pathname: string): Route | null {
  if (pathname === '/') return { kind: 'index' }
  if (pathname === '/health') return { kind: 'health' }
  if (pathname === '/api/diagrams' || pathname === '/api/diagrams/') return { kind: 'diagrams' }
  const asset = /^\/([a-z0-9][a-z0-9-]*\.(?:js|css))$/.exec(pathname)
  return asset ? { kind: 'asset', name: asset[1] } : null
}

/** `/api/diagrams/<id>[/audit]`. */
function apiRoute(pathname: string): Route | null {
  const api = /^\/api\/diagrams\/([^/]+)(\/audit)?$/.exec(pathname)
  if (!api || !ID.test(api[1])) return null
  return { kind: api[2] ? 'audit' : 'model', id: api[1] }
}

/** `/d/<id>.svg`, `/d/<id>.png`, and `/d/<id>[/<level…>]`. */
function diagramRoute(pathname: string): Route | null {
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

function routeOf(pathname: string): Route | null {
  return fixedRoute(pathname) ?? apiRoute(pathname) ?? diagramRoute(pathname)
}

/** A level path: '' or segments that each match ID (so no `..`, no absolute paths). */
function validLevel(path: string): boolean {
  return path === '' || path.split('/').every((segment) => ID.test(segment))
}

function sendModel(root: string, res: ServerResponse, id: string): void {
  const file = modelFile(root, id)
  if (!existsSync(file)) return missing(res, id)
  send(res, 200, 'application/json; charset=utf-8', readFileSync(file))
}

function sendAudit(root: string, res: ServerResponse, id: string, level: string | null): void {
  const model = loadModel(root, id)
  if (!model) return missing(res, id)
  if (level === null) return json(res, 200, renderModel(model).levels.map((l) => l.audit))
  if (!findLevel(model, level)) return noLevel(res, level, model)
  json(res, 200, renderModel(model, level).levels[0].audit)
}

function sendPage(root: string, res: ServerResponse, id: string, level: string, zoom: string | null): void {
  const model = loadModel(root, id)
  if (!model) return missing(res, id)
  if (!findLevel(model, level)) return noLevel(res, level, model)
  send(res, 200, 'text/html; charset=utf-8', viewerPage(model, level, zoom))
}

function sendExport(root: string, res: ServerResponse, id: string, level: string, format: 'svg' | 'png'): void {
  const model = loadModel(root, id)
  if (!model) return missing(res, id)
  if (!findLevel(model, level)) return noLevel(res, level, model)
  if (format === 'svg') return send(res, 200, 'image/svg+xml; charset=utf-8', renderModel(model, level).levels[0].svg)
  send(res, 200, 'image/png', readFileSync(pngFor(root, model, level)))
}

function sendAsset(res: ServerResponse, name: string): void {
  const file = join(PUBLIC, name)
  if (!existsSync(file)) return send(res, 404, 'text/plain; charset=utf-8', `${name} is not installed yet`)
  send(res, 200, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', readFileSync(file))
}

async function handle(root: string, guard: Guard, req: IncomingMessage, res: ServerResponse, pathname: string | null): Promise<void> {
  applyHeaders(res)
  if (pathname === null) return json(res, 404, { error: 'malformed path' })

  // /health stays open so a supervisor or an uptime check needs no secret; it exposes counts only.
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (guard.token && pathname !== '/health') {
    if (!allowed(guard, req, url)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="c4-view"')
      return json(res, 401, { error: 'token required', hint: 'append ?t=<token>, send Authorization: Bearer <token>, or use the link the server printed' })
    }
    remember(guard, req, url, res)
  }
  const route = routeOf(pathname)
  if (!route) return json(res, 404, { error: `no route for ${pathname}` })

  const method = req.method ?? 'GET'
  const allow = route.kind === 'diagrams' ? 'GET, POST' : 'GET'
  if (!allow.split(', ').includes(method)) {
    res.setHeader('Allow', allow)
    return json(res, 405, { error: `${method} is not allowed here` })
  }
  const level = url.searchParams.get('level')

  switch (route.kind) {
    case 'index':
      return send(res, 200, 'text/html; charset=utf-8', indexPage(indexEntries(list(root), (id) => loadModel(root, id))))
    case 'health':
      return json(res, 200, { ok: true, diagrams: list(root).length })
    case 'diagrams':
      return method === 'POST' ? create(root, req, res) : json(res, 200, list(root))
    case 'model':
      return sendModel(root, res, route.id)
    case 'audit':
      return sendAudit(root, res, route.id, level)
    case 'page':
      return sendPage(root, res, route.id, route.level, url.searchParams.get('zoom'))
    case 'export':
      return sendExport(root, res, route.id, level ?? '', route.format)
    case 'asset':
      return sendAsset(res, route.name)
  }
}

const modelFile = (root: string, id: string): string => join(root, id, 'model.json')

/** Write `.tmp` then rename: a reader never sees half a model. */
function save(root: string, id: string, raw: string): void {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  // uniqueness, not unpredictability: a uuid ends the "insecure PRNG" hotspot and cannot
  // collide between two processes writing the same id
  const tmp = join(dir, `.model.${randomUUID()}.tmp`)
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
  return validLevel(path) ? levelOf(model, path) : undefined
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

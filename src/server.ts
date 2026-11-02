/** HTTP surface: `/` is the grid, `/d/<id>` one diagram; a bad id or level segment is a 404. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelError, levelOf, parseModel } from './model.ts'
import { indexEntries, indexPage, type Filter, type Sort } from './index-page.ts'
import { docsDir, levelDocs } from './docs.ts'
import { pictureAudits, renderExpanded, renderModel } from './render.ts'
import { lensReport } from './lens.ts'
import { list, loadModel, modelFile, save } from './store.ts'
import { viewerPage } from './viewer-page.ts'
import { buildStamp } from './build.ts'
import { svgToPng } from './png.ts'
import { allowed, applyHeaders, guardFor, remember, type Guard } from './security.ts'
import { levelSlug } from './slug.ts'
import { themeCookie, themeOf, type Theme } from './theme-choice.ts'
import { broken, denied, json, missing, noLevel, redirectClean, send } from './http-reply.ts'
import { diagramRoute, routeOf, validLevel, type Route } from './routes.ts'
import type { LevelSpec, Model } from './types.ts'

const MAX_BODY = 2 * 1024 * 1024
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))

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
      /* node:coverage disable */
      // Damage guards: every throw that reaches here is an Error from our own code, and a response
      // that has already started can only be torn down. Neither state is reproducible in a test.
      const message = error instanceof Error ? error.message : String(error)
      if (res.headersSent) return res.destroy()
      /* node:coverage enable */
      // a route that names a diagram can say which file is broken; anything else can only say 500
      const asked = pathname ? diagramRoute(pathname) : null
      if (asked && 'id' in asked) return broken(req, res, asked.id)
      json(res, 500, { error: message })
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


function sendModel(root: string, req: IncomingMessage, res: ServerResponse, id: string, theme: Theme): void {
  const file = modelFile(root, id)
  if (!existsSync(file)) return missing(req, res, id, theme)
  send(res, 200, 'application/json; charset=utf-8', readFileSync(file))
}

function sendAudit(root: string, req: IncomingMessage, res: ServerResponse, id: string, level: string | null, theme: Theme): void {
  const model = loadModel(root, id)
  if (!model) return missing(req, res, id, theme)
  if (level === null) return json(res, 200, pictureAudits(model))
  if (!findLevel(model, level)) return noLevel(req, res, level, model, theme)
  // the audit of a level is the audit of the picture that level's page draws, composed and all
  json(res, 200, level ? renderExpanded(model, level).levels[0].audit : renderModel(model, level).levels[0].audit)
}

function sendPage(root: string, req: IncomingMessage, res: ServerResponse, id: string, level: string, zoom: string | null, theme: Theme): void {
  const model = loadModel(root, id)
  if (!model) return missing(req, res, id, theme)
  const found = findLevel(model, level)
  if (!found) return noLevel(req, res, level, model, theme)
  send(res, 200, 'text/html; charset=utf-8', viewerPage(model, level, zoom, theme, docsFor(root, model, id, level, found)))
}

/**
 * Docs for the page: the level's own docs, plus — when the level is a lens — the parent's docs, because an
 * expanded page still draws the neighbours that live outside the frame and a reader can hover those too.
 */
function docsFor(root: string, model: Model, id: string, level: string, found: LevelSpec): ReturnType<typeof levelDocs> {
  const dir = docsDir(modelFile(root, id), model)
  const own = levelDocs(dir, found)
  const cut = level.lastIndexOf('/')
  const parentPath = cut < 0 ? '' : level.slice(0, cut)
  const parent = model.levels.find((l) => l.path === parentPath)
  if (level === '' || !parent) return own
  const outer = levelDocs(dir, parent)
  return { nodes: { ...outer.nodes, ...own.nodes }, edges: { ...outer.edges, ...own.edges } }
}

function sendExport(root: string, req: IncomingMessage, res: ServerResponse, id: string, level: string, format: 'svg' | 'png', theme: Theme): void {
  const model = loadModel(root, id)
  if (!model) return missing(req, res, id, theme)
  if (!findLevel(model, level)) return noLevel(req, res, level, model, theme)
  if (format === 'svg') return send(res, 200, 'image/svg+xml; charset=utf-8', renderModel(model, level).levels[0].svg)
  send(res, 200, 'image/png', readFileSync(pngFor(root, model, level)))
}

function sendAsset(res: ServerResponse, name: string): void {
  const file = join(PUBLIC, name)
  if (!existsSync(file)) return send(res, 404, 'text/plain; charset=utf-8', `${name} is not installed yet`)
  send(res, 200, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', readFileSync(file))
}

/**
 * The token gate, in the order it has to happen: decide, remember, then take the token out of the URL.
 * Returns false when a response has already been sent, so `handle` stays a router.
 */
function admitted(guard: Guard, req: IncomingMessage, res: ServerResponse, url: URL, pathname: string): boolean {
  // /health stays open so a supervisor or an uptime check needs no secret; it exposes counts only.
  if (!guard.token || pathname === '/health') return true
  if (!allowed(guard, req, url)) {
    denied(req, res, themeOf(url.searchParams.get('theme'), req.headers.cookie))
    return false
  }
  remember(guard, req, url, res)
  // the token leaves the address bar on the first hop: the cookie has it now, and a token left in the
  // URL ends up in a screenshot, in history, and in any Referer that slips out
  if (url.searchParams.has('t')) redirectClean(res, url)
  return !url.searchParams.has('t')
}

/** `?sort=` → the three orders the grid offers; anything else is "newest". */
function sortOf(url: URL): Sort {
  const raw = url.searchParams.get('sort')
  return raw === 'title' || raw === 'audit' ? raw : 'updated'
}

const filterOf = (url: URL): Filter => (url.searchParams.get('audit') === 'fail' ? 'fail' : 'all')

/** 405 with the right Allow header, or true when the method is fine. */
function methodAllowed(route: Route, method: string, res: ServerResponse): boolean {
  const allow = route.kind === 'diagrams' ? 'GET, POST' : 'GET'
  if (allow.split(', ').includes(method)) return true
  res.setHeader('Allow', allow)
  json(res, 405, { error: `${method} is not allowed here` })
  return false
}

async function handle(root: string, guard: Guard, req: IncomingMessage, res: ServerResponse, pathname: string | null): Promise<void> {
  applyHeaders(res)
  if (pathname === null) return json(res, 404, { error: 'malformed path' })
  const url = new URL(req.url ?? '/', 'http://localhost') // coverage:invariant — node always sets req.url
  if (!admitted(guard, req, res, url, pathname)) return
  const route = routeOf(pathname)
  if (!route) return json(res, 404, { error: `no route for ${pathname}` })
  /* node:coverage disable */
  // node sets `method` on every request; the fallback exists because the type says maybe
  const method = req.method ?? 'GET'
  /* node:coverage enable */
  if (!methodAllowed(route, method, res)) return
  const level = url.searchParams.get('level')
  // the scheme: URL → cookie; append, so the guard's token cookie survives this one
  const theme = themeOf(url.searchParams.get('theme'), req.headers.cookie)
  if (url.searchParams.has('theme')) res.appendHeader('Set-Cookie', themeCookie(theme))

  switch (route.kind) {
    case 'index': {
      return send(
        res,
        200,
        'text/html; charset=utf-8',
        indexPage(indexEntries(list(root), (id) => loadModel(root, id), theme), theme, sortOf(url), filterOf(url)),
      )
    }
    case 'health':
      // the build is part of the health answer: a viewer left running from an older checkout serves old
      // pictures, and nothing else on the page says so
      return json(res, 200, { ok: true, diagrams: list(root).length, build: buildStamp() })
    case 'diagrams':
      return method === 'POST' ? create(root, req, res) : json(res, 200, list(root))
    case 'model':
      return sendModel(root, req, res, route.id, theme)
    case 'audit':
      return sendAudit(root, req, res, route.id, level, theme)
    case 'page':
      return sendPage(root, req, res, route.id, route.level, url.searchParams.get('zoom'), theme)
    case 'export':
      return sendExport(root, req, res, route.id, level ?? '', route.format, theme)
    case 'asset':
      return sendAsset(res, route.name)
  }
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
  const failures = lensReport(model).problems
  return json(res, 201, {
    id: model.id,
    url: `/d/${model.id}`,
    audit: pictureAudits(model),
    // what a badge can trust: geometry per picture, plus the modelling checks
    ok: pictureAudits(model).every((a) => a.ok) && failures.length === 0,
    lens: failures,
  })
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
      /* node:coverage disable */
      // Damage guard: data arriving after the body was settled means the client kept writing past a
      // refusal — the socket is already closing, so there is nothing to test but the guard itself.
      if (settled) return
      /* node:coverage enable */
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

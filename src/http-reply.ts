/**
 * The reply shapes every route ends with: one place decides the content type, the caching rule and
 * the wording of a 404, so two routes cannot answer the same question differently.
 *
 * @module c4-view/http-reply
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Model } from './types.ts'
import { levelOrder } from './model.ts'
import { deniedPage } from './denied-page.ts'
import { brokenModel, missingDiagram, missingLevel } from './state-page.ts'
import type { Theme } from './theme-choice.ts'

export function send(res: ServerResponse, status: number, type: string, body: string | Buffer, filename?: string): void {
  // a page built from the token-bearing request must not be cached by anything on the way back
  if (type.startsWith('text/html')) res.setHeader('Cache-Control', 'no-store')
  const headers: Record<string, string | number> = { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) }
  // an export is a file, so it is named: the browser saves it instead of opening a tab of bare svg
  if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`
  res.writeHead(status, headers)
  res.end(body)
}

/** A browser gets a page it can read; an agent gets JSON. */
export const acceptsHtml = (req: IncomingMessage): boolean => (req.headers.accept ?? '').includes('text/html')

/**
 * Same URL, without `t` — everything else (`zoom`, `theme`, the level in the path) is kept, so the
 * reader lands on exactly the drawing they asked for.
 */
export function redirectClean(res: ServerResponse, url: URL): void {
  const clean = new URLSearchParams(url.searchParams)
  clean.delete('t')
  const query = clean.toString()
  res.writeHead(302, {
    Location: url.pathname + (query ? `?${query}` : ''),
    // a 302 carrying a credential's successor must never be cached
    'Cache-Control': 'no-store',
  })
  res.end()
}

export function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value))
}
/** No diagram: a page for a browser, JSON for an agent. */
export function missing(req: IncomingMessage, res: ServerResponse, id: string, theme: Theme = 'auto'): void {
  if (acceptsHtml(req)) return send(res, 404, 'text/html; charset=utf-8', missingDiagram(id, theme))
  json(res, 404, { error: `no diagram "${id}"` })
}
export function noLevel(req: IncomingMessage, res: ServerResponse, level: string, model: Model, theme: Theme = 'auto'): void {
  const paths = levelOrder(model).map((l) => l.path)
  if (acceptsHtml(req)) return send(res, 404, 'text/html; charset=utf-8', missingLevel(level, paths, theme))
  json(res, 404, { error: `no level "${level}"`, levels: paths })
}

/** A model on disk that will not parse: 500, and a page that says which file to fix. */
export function broken(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  theme: Theme = 'auto',
  reason = '',
  file = `${id}/model.json`,
): void {
  if (acceptsHtml(req)) return send(res, 500, 'text/html; charset=utf-8', brokenModel(id, theme, reason, file))
  json(res, 500, { error: `model "${id}" does not validate`, problem: reason })
}

/** The 401: a browser gets a page that states one cause, an agent gets JSON. */
export function denied(req: IncomingMessage, res: ServerResponse, theme: Theme = 'auto'): void {
  res.setHeader('WWW-Authenticate', 'Bearer realm="c4-view"')
  // a cached 401 outlives the mistake that caused it: the tab keeps showing "token required" after a
  // correct key has been supplied
  res.setHeader('Cache-Control', 'no-store')
  if (acceptsHtml(req)) return send(res, 401, 'text/html; charset=utf-8', deniedPage(theme))
  json(res, 401, { error: 'token required', hint: 'append ?t=<token> or send Authorization: Bearer ***' })
}

/**
 * Which request is which: the path decides the route, before any handler runs.
 *
 * Pure path → `Route`, no IO, so a URL that should 404 can be tested without a server.
 *
 * @module c4-view/routes
 */

/** An id is a directory name: one character class, one length ceiling, used everywhere. */
export const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export type Route =
  | { kind: 'health' | 'diagrams' | 'index' }
  | { kind: 'model' | 'audit'; id: string }
  | { kind: 'page'; id: string; level: string }
  | { kind: 'export'; format: 'svg' | 'png'; id: string }
  | { kind: 'asset'; name: string }

/** `/`, `/health`, `/api/diagrams` and the public assets — no id, no level. */
export function fixedRoute(pathname: string): Route | null {
  if (pathname === '/') return { kind: 'index' }
  if (pathname === '/health') return { kind: 'health' }
  if (pathname === '/api/diagrams' || pathname === '/api/diagrams/') return { kind: 'diagrams' }
  const asset = /^\/([a-z0-9][a-z0-9-]*\.(?:js|css))$/.exec(pathname)
  return asset ? { kind: 'asset', name: asset[1] } : null
}

/** `/api/diagrams/<id>[/audit]`. */
export function apiRoute(pathname: string): Route | null {
  const api = /^\/api\/diagrams\/([^/]+)(\/audit)?$/.exec(pathname)
  if (!api || !ID.test(api[1])) return null
  return { kind: api[2] ? 'audit' : 'model', id: api[1] }
}

/** `/d/<id>.svg`, `/d/<id>.png`, and `/d/<id>[/<level…>]`. */
export function diagramRoute(pathname: string): Route | null {
  if (!pathname.startsWith('/d/')) return null
  const rest = pathname.slice(3)
  const exported = /^([^/]+)\.(svg|png)$/.exec(rest)
  if (exported) {
    if (!ID.test(exported[1])) return null
    return { kind: 'export', format: exported[2] === 'svg' ? 'svg' : 'png', id: exported[1] }
  }
  const segments = rest.split('/')
  // a path that starts with /d/ always yields at least one segment, empty or not
  const id = segments.shift() as string
  if (!ID.test(id)) return null
  const level = segments.join('/')
  if (level !== '' && !validLevel(level)) return null
  return { kind: 'page', id, level }
}

export function routeOf(pathname: string): Route | null {
  return fixedRoute(pathname) ?? apiRoute(pathname) ?? diagramRoute(pathname)
}

/** A level path: '' or segments that each match ID (so no `..`, no absolute paths). */
export function validLevel(path: string): boolean {
  return path === '' || path.split('/').every((segment) => ID.test(segment))
}

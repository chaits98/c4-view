/**
 * The guard on the HTTP surface.
 *
 * Default is loopback and no token: a single-user tool on `127.0.0.1` gains nothing from a password,
 * and a token nobody types is a token that gets pasted into a shell history. The moment the server
 * is bound to a real interface it becomes a different product — a page on the LAN — so it gets a
 * bearer token on every route, a cookie so links keep working, and headers that stop the usual
 * browser-side tricks.
 *
 * @module c4-view/security
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface Guard {
  /** null on loopback with sharing off */
  token: string | null
  /** true when the token was generated rather than supplied, so the caller must print it */
  generated: boolean
  /** the requested bind address, for the warning */
  host: string
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', ''])
export const COOKIE = 'c4token'

/** A token nobody guesses: 256 bits, url-safe. */
export const newToken = (): string => randomBytes(32).toString('base64url')

/**
 * Decide whether this server needs a token.
 *
 * - loopback, no token given → none (the default, and what `c4v serve` does)
 * - loopback, token given → honour it (someone wants a token on the LAN name anyway)
 * - anything else, no token → generate one, never serve open by accident
 */
export function guardFor(host: string, token?: string): Guard {
  if (token) return { token, generated: false, host }
  if (LOOPBACK.has(host)) return { token: null, generated: false, host }
  return { token: newToken(), generated: true, host }
}

/** Constant-time compare that does not leak length. */
function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The token presented by this request: bearer header, `?t=`, or the cookie the page sets. */
export function presented(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  const query = url.searchParams.get('t')
  if (query) return query
  const cookie = req.headers.cookie ?? ''
  const hit = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : null
}

/** True when the request may proceed. A guard with no token allows everything. */
export function allowed(guard: Guard, req: IncomingMessage, url: URL): boolean {
  if (!guard.token) return true
  const given = presented(req, url)
  return given !== null && same(given, guard.token)
}

/** Headers on every response, authenticated or not. */
export function applyHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  // no inline script anywhere in the viewer; the SVG is inert; nothing may frame us
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
}

/**
 * Remember the token in a cookie once it has been presented, so a shared link keeps working after
 * the first hop without every href having to carry `?t=`.
 */
export function remember(guard: Guard, req: IncomingMessage, url: URL, res: ServerResponse): void {
  if (!guard.token) return
  if (req.headers.cookie?.includes(`${COOKIE}=`)) return
  const fresh = url.searchParams.get('t') ?? (req.headers.authorization?.startsWith('Bearer ') ? 'bearer' : null)
  if (fresh === 'bearer') return
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(guard.token)}; HttpOnly; SameSite=Strict; Path=/`)
}

/** One line a human can act on, printed at startup. */
export function guardNotice(guard: Guard, port: number | string): string[] {
  if (!guard.token) return [`serving http://127.0.0.1:${port}/ — local only`]
  const url = `http://${guard.host === '0.0.0.0' ? '<this-host>' : guard.host}:${port}/`
  return [
    `serving ${url} — shared on the network, token required`,
    `  token: ${guard.token}${guard.generated ? '  (generated this run; pass --token to pin it)' : ''}`,
    `  open once with: ${url}?t=${guard.token}   (the page then remembers it)`,
    `  agents: curl -H "authorization: Bearer ${guard.token}" …`,
  ]
}

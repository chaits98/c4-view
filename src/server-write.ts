/**
 * The three requests that change the store: create, pin, delete.
 *
 * Everything here runs only after the token gate and the origin check have said yes, so the job is narrow —
 * read a body that cannot be trusted, hand it to the store, answer with what the store did.
 *
 * @module c4-view/server-write
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ModelError, parseModel } from './model.ts'
import { pictureAudits } from './render.ts'
import { lensReport } from './lens.ts'
import { remove, save, setPinned } from './store.ts'
import { json } from './http-reply.ts'
import type { Model } from './types.ts'

const MAX_BODY = 2 * 1024 * 1024

/** The body as text, or null once a 413 has been answered and the socket closed. */
export function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
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

export async function create(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
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

/** Delete a diagram. The docs beside it go with it — they are about that model and nothing else. */
export function drop(root: string, res: ServerResponse, id: string): void {
  if (!remove(root, id)) return json(res, 404, { error: `no diagram ${id}` })
  return json(res, 200, { id, removed: true })
}

/** Pin or unpin one diagram. The body says which: `{"pinned": true}`. */
export async function pin(root: string, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const raw = await readBody(req, res)
  if (raw === null) return
  let wanted: unknown
  try {
    wanted = (JSON.parse(raw || '{}') as { pinned?: unknown }).pinned
  } catch {
    return json(res, 400, { error: 'body: not valid JSON' })
  }
  if (typeof wanted !== 'boolean') return json(res, 400, { error: 'body.pinned must be true or false' })
  if (!setPinned(root, id, wanted)) return json(res, 404, { error: `no diagram ${id}` })
  return json(res, 200, { id, pinned: wanted })
}

# Guard

**C4V-30** · service-logic · `src/security.ts`

One token: query, header or cookie. Refreshes a stale cookie, never prints the token to a log.

## Where it sits

A component inside the long-lived server. Every box here answers a request the guard let through. Shown on the **C3 · inside the viewer server** level.

## What to know

One token: query, header or cookie. Refreshes a stale cookie, never prints the token to a log.

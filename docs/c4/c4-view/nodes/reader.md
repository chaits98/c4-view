# Store reader

**C4V-35** · file-storage · `src/store.ts`

Reads the published models off disk; a missing directory is an empty list, not an error.

## Where it sits

A component inside the long-lived server. Every box here answers a request the guard let through. Shown on the **C3 · inside the viewer server** level.

## What to know

Reads `~/.c4-view/<id>/model.json` plus the docs beside it. A missing directory is an empty list.

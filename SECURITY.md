# Security

c4-view renders what an agent wrote. It runs on your machine, writes files you asked for, and — only
if you ask it to — serves a read-only viewer on your network. That is the whole attack surface.

## Supported versions

Only the latest minor gets fixes. The model format and the CLI are versioned together (see
`CHANGELOG.md`); a security fix ships as a patch release with a note here.

## Reporting a vulnerability

Open a private security advisory on the repository (Security → Advisories → New). If that is not
available to you, open an issue that says only "security report, please contact me" and nothing else,
and a maintainer will reach out.

- Acknowledgement: within **72 hours**.
- Fix or a written mitigation plan: within **90 days**, sooner for anything remotely reachable.
- Credit: given in the advisory unless you ask otherwise.

Please do not include exploit details in a public issue, and do not test against other people's
viewers.

## How this tool is expected to be deployed

| Deployment | Auth | Notes |
|---|---|---|
| `c4v serve` (default) | none | binds `127.0.0.1` — a single-user tool on loopback |
| `c4v serve --host 0.0.0.0` | **required** | a token is generated if you do not pass `--token`; the server never starts open |
| `c4v service install --host …` | **required** | the token is written once to `~/.config/c4-view/env` (mode 600) so links survive restarts |

When a token is set it is accepted as `Authorization: Bearer`, as `?t=` for the first click, or as an
`HttpOnly; SameSite=Strict` cookie the page sets for itself. Every response carries
`Content-Security-Policy` (`script-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `no-referrer` and
`X-Frame-Options: DENY`. `/health` is deliberately unauthenticated and exposes counts only.

There is no TLS. If you expose the viewer beyond a trusted network, put it behind a reverse proxy that
terminates TLS.

## What this tool deliberately does not do

- **No authentication of who you are.** One token, one door. Multi-user access is out of scope.
- **No sandboxing of the model.** A model is data: it is validated, escaped on the way into SVG and
  HTML, and never executed. The only process it can start is the browser used for `--png`.
- **No network access of its own.** Nothing is fetched, uploaded or phoned home; there is no telemetry.
  The one outbound action is `--png` starting a local Chromium binary.
- **No writes outside the paths you name.** The store root (`~/.c4-view` by default), `--out`, and the
  systemd unit on install.

## Known limitations worth knowing before you expose it

- `POST /api/diagrams` accepts up to 2 MB of JSON. Layout is superlinear in node count; a pathological
  model costs CPU. Keep the token private and the port off the public internet.
- `--png` passes `--no-sandbox` to Chromium **only when running as root** (containers). Everywhere else
  the browser sandbox stays on.
- The viewer's token is stored in a cookie over plain HTTP. On a shared network anyone who can read your
  traffic can read it; see the TLS note above.

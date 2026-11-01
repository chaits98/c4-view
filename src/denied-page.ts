/**
 * The 401, as a page.
 *
 * A JSON error is fine for an agent and useless for a person: the first thing a new user sees on a
 * shared viewer is this refusal, so it states one cause and one recovery, and nothing else. No
 * script, no inline style — the CSP (`default-src 'none'; style-src 'self'`) applies to it too.
 *
 * @module c4-view/denied-page
 */

export function deniedPage(): string {
  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>c4-view — token required</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/viewer.css">
</head>
<body class="t-body-m">
<main class="c4-denied">
  <h1 class="t-headline-s">This viewer needs its token</h1>
  <p>The link you opened has no token, or the token does not match the one this server is using.</p>
  <p>Open the link <code>c4v serve</code> printed — it looks like <code>http://&lt;host&gt;:8788/?t=…</code>. The
  page remembers it after the first visit. An agent sends <code>Authorization: Bearer …</code> instead.</p>
</main>
</body>
</html>
`
}

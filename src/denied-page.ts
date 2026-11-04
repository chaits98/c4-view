/**
 * The 401, as a page.
 *
 * A JSON error is fine for an agent and useless for a person: the first thing a new user sees on a
 * shared viewer is this refusal, so it states one cause and one recovery, and nothing else. No
 * script, no inline style — the CSP (`default-src 'none'; style-src 'self'`) applies to it too.
 *
 * @module c4-view/denied-page
 */
import { themeAttribute, type Theme } from './theme-choice.ts'

export function deniedPage(theme: Theme = 'auto'): string {
  return `<!doctype html>
<html lang="en"<!--THEMEATTR-->>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>c4-view — token required</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/viewer.css">
<link rel="stylesheet" href="/viewer-states.css">
</head>
<body class="t-body-m">
<main class="c4-denied">
  <h1 class="t-headline-s">This viewer needs its token</h1>
  <p>The link you opened has no token, or the token does not match the one this server is using.</p>
  <form class="c4-denied-form" method="get" action="/">
    <input class="c4-denied-key" type="password" name="t" autocomplete="off" spellcheck="false"
           aria-label="Viewer token" placeholder="paste the token" required>
    <button class="c4-denied-go" type="submit">Open</button>
  </form>
  <p>The token is in <code>~/.config/c4-view/open-url</code> on the machine running the viewer, or in the line
  <code>c4v serve</code> printed. A cookie only covers the host name it was set on, so a page opened as
  <code>http://&lt;host&gt;:8788</code> is not signed in on <code>http://localhost:8788</code>. An agent sends
  <code>Authorization: Bearer &lt;token&gt;</code> instead.</p>
</main>
</body>
</html>
`.replace('<!--THEMEATTR-->', themeAttribute(theme))
}

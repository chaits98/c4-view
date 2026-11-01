/**
 * The states a user meets before any diagram: an id that is not there, a model that will not parse,
 * and a store with nothing in it.
 *
 * Each one is a page with a heading, one sentence of cause and one next action — never a blank
 * rectangle, never a stack trace, never a spinner. They are the first thing a new machine shows, so
 * they are written like the product, not like a debug endpoint.
 *
 * @module c4-view/state-page
 */

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>c4-view — ${title}</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/viewer.css">
</head>
<body class="t-body-m">
<main class="c4-denied">
${body}
</main>
</body>
</html>
`

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** No diagram with that id. */
export function missingDiagram(id: string): string {
  return shell(
    'no such diagram',
    `<h1 class="t-headline-s">There is no diagram called “${escape(id)}”</h1>
<p>This server is holding a different set of diagrams than the link expects.</p>
<p>Open <a href="/">all diagrams</a> to see what is here, or render this one again with
<code>c4v render &lt;model.json&gt;</code>.</p>`,
  )
}

/** A level path inside a diagram that does not exist. */
export function missingLevel(level: string, levels: string[]): string {
  const known = levels.map((path) => (path === '' ? 'Overview' : escape(path))).join(' · ')
  return shell(
    'no such level',
    `<h1 class="t-headline-s">This diagram has no level “${escape(level)}”</h1>
<p>The levels it does have: ${known || 'none'}.</p>
<p>Go back to the <a href="./">first level</a>, or fix the link.</p>`,
  )
}

/** The file is there and is not a model — a crashed writer, a half-written upload, a bad edit. */
export function brokenModel(id: string): string {
  return shell(
    'model will not parse',
    `<h1 class="t-headline-s">“${escape(id)}” is on disk but will not parse</h1>
<p>The file exists and its JSON does not validate, so drawing it would be a guess.</p>
<p>Re-render it with <code>c4v render</code>, or delete <code>${escape(id)}/model.json</code> from the
store to take the card away.</p>`,
  )
}

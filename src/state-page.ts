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
import { themeAttribute, type Theme } from './theme-choice.ts'

const shell = (title: string, body: string, theme: Theme): string => `<!doctype html>
<html lang="en"<!--THEMEATTR-->>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>c4-view — ${title}</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/viewer.css">
<link rel="stylesheet" href="/viewer-states.css">
</head>
<body class="t-body-m">
<main class="c4-denied">
${body}
</main>
</body>
</html>
`.replace('<!--THEMEATTR-->', themeAttribute(theme))

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** The five characters that end an HTML attribute if they are not escaped. */
const escape = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c])

/** No diagram with that id. */
export function missingDiagram(id: string, theme: Theme = 'auto'): string {
  return shell(
    'no such diagram',
    `<h1 class="t-headline-s">There is no diagram called “${escape(id)}”</h1>
<p>This server is holding a different set of diagrams than the link expects.</p>
<p>Open <a href="/">all diagrams</a> to see what is here, or render this one again with
<code>c4v render &lt;model.json&gt;</code>.</p>`,
    theme,
  )
}

/** A level path inside a diagram that does not exist. */
export function missingLevel(level: string, levels: string[], theme: Theme = 'auto'): string {
  const known = levels.map((path) => (path === '' ? 'Overview' : escape(path))).join(' · ')
  return shell(
    'no such level',
    `<h1 class="t-headline-s">This diagram has no level “${escape(level)}”</h1>
<p>The levels it does have: ${known || 'none'}.</p>
<p>Go back to the <a href="./">first level</a>, or fix the link.</p>`,
    theme,
  )
}

/** The file is there and is not a model — a crashed writer, a half-written upload, an out-of-date rule. */
export function brokenModel(id: string, theme: Theme = 'auto', reason = '', file = `${id}/model.json`): string {
  // two different failures deserve two different sentences: JSON that does not parse is a broken write, a
  // model that breaks a rule is a diagram from before the rule and can be repaired
  const rules = /^levels\[|^model|^layout|^nodes|^edges/.test(reason)
  const cause = rules
    ? 'It is valid JSON, but it does not pass the model rules any more — so drawing it would be a guess.'
    : 'The file exists and its JSON does not parse, so drawing it would be a guess.'
  const problem = reason ? `<p><strong>First problem:</strong> <code>${escape(reason)}</code></p>` : ''
  const fix = rules
    ? `<p>See every problem it has: <code>c4v audit ${escape(file)}</code>. Then add what it names, or delete it from the store to take the card away.</p>`
    : `<p>Re-render it with <code>c4v render</code>, or delete <code>${escape(file)}</code> from the store to take the card away.</p>`
  return shell(
    'model will not parse',
    `<h1 class="t-headline-s">“${escape(id)}” is on disk but will not draw</h1>
<p>${cause}</p>
${problem}
${fix}`,
    theme,
  )
}

/**
 * Docs: the markdown subset that renders in the hover panel, and the check that every node and edge of
 * the sample has something to say. Both are about prose, so the tests are about what a reader gets —
 * escaping first, structure second.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isEmptyDoc, markdown } from '../src/markdown.ts'
import { docsProblems, levelDocs, stripLeadingHeading } from '../src/docs.ts'
import { parseModel } from '../src/model.ts'

test('markdown renders paragraphs, emphasis, code and links', () => {
  const html = markdown('A **bold** word, an *italic* one, `code`, and a [link](https://example.com).\n\nSecond para.')
  assert.match(html, /<p>A <strong>bold<\/strong> word, an <em>italic<\/em> one, <code>code<\/code>, and a <a href="https:\/\/example.com">link<\/a>.<\/p>/)
  assert.match(html, /<p>Second para.<\/p>/)
})

test('markdown escapes everything before it decorates, so a doc cannot inject html', () => {
  const html = markdown('<script>alert(1)</script> & "quotes"')
  assert.ok(!html.includes('<script>'), 'no live tag')
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&amp;/)
})

test('markdown refuses a javascript: link but keeps the label', () => {
  const html = markdown('[click](javascript:alert(1))')
  assert.ok(!html.includes('href="javascript'), 'no javascript: target')
  assert.match(html, /click/)
})

test('headings, lists and fenced code keep their structure', () => {
  const html = markdown('## Detail\n\n- one\n- two\n\n1. first\n2. second\n\n```\nconst x = 1 < 2\n```')
  assert.match(html, /<h2>Detail<\/h2>/)
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/)
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/)
  assert.match(html, /<pre><code>const x = 1 &lt; 2<\/code><\/pre>/)
})

test('an empty or comment-only doc is empty', () => {
  assert.equal(isEmptyDoc('   \n\n'), true)
  assert.equal(isEmptyDoc('<!-- generated -->\n'), true)
  assert.equal(isEmptyDoc('A sentence.'), false)
})

test('a leading heading is dropped for the hover panel, which already prints the label', () => {
  assert.equal(stripLeadingHeading('# Context 1\n\nBody.'), 'Body.')
  assert.equal(stripLeadingHeading('## Deep\nBody.'), 'Body.')
  // a heading with emphasis in it stays: it is saying something the label does not
  assert.match(stripLeadingHeading('# **Not** the same\nBody.'), /^# \*\*Not\*\*/)
})

test('levelDocs reads nodes and edges from beside the model, and skips what is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-docs-'))
  mkdirSync(join(dir, 'nodes'))
  mkdirSync(join(dir, 'edges'))
  writeFileSync(join(dir, 'nodes', 'a.md'), '# a\n\nTakes the request.\n')
  const model = parseModel({
    id: 'x',
    title: 'X',
    levels: [
      {
        path: '',
        nodes: [
          { id: 'a', label: 'A', subtype: 'system' },
          { id: 'b', label: 'B', subtype: 'system' },
        ],
        edges: [{ from: 'a', to: 'b', label: 'calls' }],
      },
    ],
  })
  const docs = levelDocs(dir, model.levels[0])
  assert.deepEqual(Object.keys(docs.nodes), ['a'], 'only the documented node appears')
  assert.match(docs.nodes.a, /<p>Takes the request\.<\/p>/)
  assert.ok(!docs.nodes.a.includes('<h1>'), 'the label is not repeated inside the panel')
  assert.deepEqual(docs.edges, {}, 'a missing edge doc is absent, not empty')
})

test('docsProblems names every node and edge without a doc, with the path it should have', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-docs-'))
  const model = parseModel({
    id: 'x',
    title: 'X',
    levels: [
      { path: '', nodes: [{ id: 'a', label: 'A', subtype: 'system' }], edges: [] },
      {
        path: 'a',
        nodes: [
          { id: 'inner', label: 'I', subtype: 'function' },
          { id: 'other', label: 'O', subtype: 'function' },
        ],
        edges: [{ from: 'inner', to: 'other', label: 'calls' }],
      },
    ],
  })
  const problems = docsProblems(dir, model)
  assert.equal(problems.length, 4, 'one root node, two interior nodes and one interior edge')
  assert.ok(problems.every((p) => p.path.endsWith('.md')))
  assert.deepEqual(problems.map((p) => p.where), ['(root)', 'a', 'a', 'a'], 'level order: root, then the drill level')
})

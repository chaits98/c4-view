/**
 * A small Markdown subset, rendered to HTML for the hover panel.
 *
 * Why not a parser library: the viewer has zero runtime dependencies and the hover text is a paragraph
 * or two about one component. This handles exactly what an authored doc actually contains — headings,
 * bold, italic, inline code, fenced code, lists, links, paragraphs — and escapes everything else, so a
 * doc that says `<script>` shows the tag instead of becoming one.
 *
 * The parser is line-oriented and split into one function per block type: an earlier single-loop version
 * scored 23 on cognitive complexity and mutated its loop counter to consume fenced code, which is exactly
 * the shape of parser that grows a bug the first time somebody adds a block type.
 *
 * @module c4-view/markdown
 */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)

/**
 * Inline spans as ONE left-to-right scan: code, links, bold, italic.
 *
 * No regexes on purpose. Two of them were flagged as possible super-linear scans (S5852), and the input is
 * prose where a pathological line is unlikely but not impossible; a scanner has no backtracking to reason
 * about. Everything that is not markup is escaped as it is copied, so a doc cannot inject a tag.
 */
function inline(raw: string): string {
  let out = ''
  let plain = ''
  let bold = false
  let italic = false
  let at = 0
  const flush = (): void => {
    out += esc(plain)
    plain = ''
  }
  const toggle = (marker: string, open: string, close: string, on: boolean): void => {
    flush()
    out += on ? open : close
    void marker
  }
  while (at < raw.length) {
    const ch = raw[at]
    if (ch === '`') {
      const close = raw.indexOf('`', at + 1)
      if (close > at) {
        flush()
        out += `<code>${esc(raw.slice(at + 1, close))}</code>`
        at = close + 1
        continue
      }
    }
    if (ch === '[') {
      const mid = raw.indexOf('](', at + 1)
      const end = mid > 0 ? raw.indexOf(')', mid + 2) : -1
      if (mid > 0 && end > 0) {
        flush()
        out += link(raw.slice(at + 1, mid), raw.slice(mid + 2, end))
        at = end + 1
        continue
      }
    }
    if (raw.startsWith('**', at)) {
      toggle('**', '<strong>', '</strong>', !bold)
      bold = !bold
      at += 2
      continue
    }
    if (ch === '*') {
      toggle('*', '<em>', '</em>', !italic)
      italic = !italic
      at += 1
      continue
    }
    plain += ch
    at += 1
  }
  flush()
  return out
}

/** A link: http(s), site-relative, anchor, or a bare slug. Anything else keeps its words, drops the target. */
function link(rawLabel: string, rawHref: string): string {
  const href = rawHref.trim()
  const safe = /^(https?:\/\/|\/|#|[a-z0-9._-]+$)/i.test(href)
  return safe ? `<a href="${esc(href)}">${esc(rawLabel)}</a>` : esc(rawLabel)
}

const isFence = (line: string): boolean => line.trimStart().startsWith('```')
const isItem = (line: string): boolean => /^\s*([-*+]|\d+\.)\s+/.test(line)
const isOrdered = (line: string): boolean => /^\s*\d+\.\s+/.test(line)
const headingLevel = (line: string): number => {
  const match = /^(#{1,4})\s+/.exec(line)
  return match ? match[1].length : 0
}

/** A run of lines starting at `from` while `keep` holds; the index it stopped at. */
function takeWhile(lines: string[], from: number, keep: (line: string) => boolean): { lines: string[]; next: number } {
  const taken: string[] = []
  let at = from
  while (at < lines.length && keep(lines[at])) {
    taken.push(lines[at])
    at += 1
  }
  return { lines: taken, next: at }
}

/** One list item, and the ordered/unordered decision that belongs to its marker. */
function listItem(line: string): string {
  const body = line.trim().replace(/^([-*+]|\d+\.)\s+/, '')
  return `<li>${inline(body)}</li>`
}

/**
 * Render the subset. Returns '' for an empty document, so a caller can treat "no doc" and "blank doc"
 * the same way — which is what the docs check wants to say.
 */
export function markdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]
    if (isFence(line)) {
      const fenced = takeWhile(lines, at + 1, (inner) => !isFence(inner))
      out.push(`<pre><code>${esc(fenced.lines.join('\n'))}</code></pre>`)
      at = fenced.next + 1 // past the closing fence
      continue
    }
    if (!line.trim()) {
      at += 1
      continue
    }
    const level = headingLevel(line)
    if (level) {
      out.push(`<h${level}>${inline(line.slice(level + 1).trim())}</h${level}>`)
      at += 1
      continue
    }
    if (isItem(line)) {
      const items = takeWhile(lines, at, isItem)
      const tag = isOrdered(line) ? 'ol' : 'ul'
      out.push(`<${tag}>${items.lines.map(listItem).join('')}</${tag}>`)
      at = items.next
      continue
    }
    const paragraph = takeWhile(lines, at, (inner) => Boolean(inner.trim()) && !isFence(inner) && !isItem(inner) && !headingLevel(inner))
    out.push(`<p>${inline(paragraph.lines.map((p) => p.trim()).join(' '))}</p>`)
    at = paragraph.next
  }
  return out.join('')
}

/** True when a document has nothing a reader could use (blank, or only HTML comments). */
export const isEmptyDoc = (source: string): boolean => source.replace(/<!--[\s\S]*?-->/g, '').trim().length === 0

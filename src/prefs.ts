/**
 * Preferences — the answers a user gives once, and the questions they still have to answer.
 *
 * The rule that makes this worth having: **the question set grows, the answers do not.** A new release adds
 * a line to `skill/preferences.jsonl`; the next time the user talks to the skill, the unanswered lines are
 * pending and the skill asks those — in one short, friendly message — instead of re-interviewing them or
 * silently defaulting a decision that is theirs.
 *
 * Stored in `~/.c4-view/prefs.json` so it survives reinstalls of the package and re-installs of the skill.
 *
 * @module c4-view/prefs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One line of the question set. `since` is the version that introduced it. */
export interface Question {
  id: string
  since: string
  question: string
  options: string[]
  default: string
  why: string
  /** dotted path in the saved answer object, e.g. `viewer.mode` */
  store: string
  /** option label → stored value */
  values?: Record<string, string>
}

export interface Prefs {
  /** tool + skill version last seen by the user, for "what is new" messaging */
  seen: { version: string; at: string } | null
  answers: Record<string, string>
}

const ROOT = fileURLToPath(new URL('../skill/', import.meta.url))

export const prefsPath = (): string => join(homedir(), '.c4-view', 'prefs.json')

/** The bundled question set, newest additions last. Missing file = no interview, not a crash. */
export function questions(file = join(ROOT, 'preferences.jsonl')): Question[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Question)
}

export function loadPrefs(file = prefsPath()): Prefs {
  if (!existsSync(file)) return { seen: null, answers: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Prefs
    return { seen: parsed.seen ?? null, answers: parsed.answers ?? {} }
  } catch {
    // a corrupt file must not brick the tool: keep the file for inspection, start clean
    return { seen: null, answers: {} }
  }
}

export function savePrefs(prefs: Prefs, file = prefsPath()): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`)
}

/** Questions the user has not answered yet — the whole point of the mechanism. */
export function pending(all: Question[], prefs: Prefs): Question[] {
  return all.filter((question) => prefs.answers[question.store] === undefined)
}

/**
 * Turn what the user said into what we store. Accepts the option label, or the short stored value — and
 * rejects anything else, because a silently-stored typo is a preference that never takes effect.
 */
function resolveAnswer(question: Question, given: string): string {
  const trimmed = given.trim()
  const mapped = question.values ? question.values[trimmed] : undefined
  const short = question.values ? Object.values(question.values) : []
  const value = mapped ?? (question.values ? (short.includes(trimmed) ? trimmed : undefined) : trimmed)
  const allowed = question.values ? [...question.options, ...short] : question.options
  if (value === undefined || (!question.values && !question.options.includes(trimmed)) || value === '') {
    throw new Error(`"${given}" is not one of: ${allowed.join(' | ')}`)
  }
  return value
}

/** Record one answer by question id (not by store path — the caller should not need to know both). */
export function answer(all: Question[], prefs: Prefs, id: string, given: string): Prefs {
  const question = all.find((q) => q.id === id)
  if (!question) throw new Error(`unknown question "${id}"`)
  const value = resolveAnswer(question, given)
  return { ...prefs, answers: { ...prefs.answers, [question.store]: value } }
}

/**
 * What a returning user should hear: nothing, a one-line "new questions", or a one-line "new version".
 * Deliberately returns a sentence the skill can print verbatim, so the tone is decided once, here.
 */
export function greeting(all: Question[], prefs: Prefs, version: string): string | null {
  const waiting = pending(all, prefs)
  if (waiting.length) {
    const first = waiting[0]
    return waiting.length === 1
      ? `c4-view has one question before it can set itself up: ${first.question}`
      : `c4-view has ${waiting.length} quick questions before it can set itself up — the first: ${first.question}`
  }
  if (prefs.seen && prefs.seen.version !== version) {
    return `c4-view updated to ${version}. Nothing new to answer; here is what changed: CHANGELOG.md`
  }
  return null
}

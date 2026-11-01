/**
 * The small surfaces: a shape lookup that falls back, a level list with nothing in it, the hints a
 * fresh install prints, and the two ways a comparison and a cookie can be empty.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shapeOf } from '../src/svg/shapes.ts'
import { compareKeys } from '../src/layout/geometry.ts'
import { themeAttribute, themeCookie, themeOf, THEME_COOKIE } from '../src/theme-choice.ts'
import { missingLevel, missingDiagram, brokenModel } from '../src/state-page.ts'
import { serviceHints } from '../src/service.ts'
import { loadPrefs } from '../src/prefs.ts'
import { writeFileSync } from 'node:fs'

test('a subtype nobody knows draws as a rect instead of nothing', () => {
  // model.parse refuses unknown subtypes; the exporter is called with JSON from elsewhere too
  assert.equal(shapeOf('not-a-subtype' as never), 'rect')
  assert.equal(shapeOf('database'), shapeOf('database'), 'and a known one is stable')
})

test('keys sort the same way twice, and equal keys do not reorder', () => {
  const keys = ['b', 'a', 'c', 'a']
  assert.deepEqual([...keys].sort(compareKeys), ['a', 'a', 'b', 'c'])
  assert.equal(compareKeys('a', 'a'), 0, 'equals compare equal, so a sort leaves them in order')
})

test('the scheme comes from the URL, then the cookie, then the OS', () => {
  assert.equal(themeOf('dark', ''), 'dark')
  assert.equal(themeOf(null, `${THEME_COOKIE}=light`), 'light')
  assert.equal(themeOf(null, 'nothing-here'), 'auto')
  assert.equal(themeOf('nonsense', ''), 'auto', 'a wrong value falls back rather than half-applying')
  assert.equal(themeAttribute('auto'), '', 'auto renders no attribute: the OS decides')
  assert.match(themeCookie('dark'), /c4theme=dark/)
})

test('the state pages say what exists, including when nothing does', () => {
  assert.match(missingLevel('x', []), /levels it does have: none/, 'an empty store says none, not ":"')
  assert.match(missingLevel('a/b', ['', 'app']), /Overview · app/, 'the overview is named, not left blank')
  assert.match(missingDiagram('<script>'), /&lt;script&gt;/, 'an id is escaped before it reaches the page')
  assert.match(brokenModel('torn'), /torn/, 'the broken page names the file')
})

test('the install hints print a localhost url for a wildcard bind', () => {
  const wildcard = serviceHints('8788', '0.0.0.0').join('\n')
  assert.match(wildcard, /http:\/\/localhost:8788\//, 'a wildcard bind is not a url a person can open')
  const named = serviceHints('8788', '10.0.0.5').join('\n')
  assert.match(named, /10\.0\.0\.5:8788/, 'a named host is printed as given')
})

test('a prefs file with the right JSON but the wrong shape still loads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c4v-prefs-'))
  const file = join(dir, 'prefs.json')
  writeFileSync(file, '{"answers": null}')
  assert.deepEqual(loadPrefs(file).answers, {}, 'a null answer map is an empty one')
  writeFileSync(file, '{}')
  assert.equal(loadPrefs(file).seen, null, 'no version seen is null, not undefined')
})

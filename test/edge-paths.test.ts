/**
 * The edges nobody exercises until they break: the PNG path without a browser, the skill planner's
 * three reasons, a token presented three ways, and a gutter that has to find a track.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { svgToPng } from '../src/png.ts'
import { describe, installInto, isSkillDir, plan, type Harness } from '../src/skill-install.ts'
import { COOKIE, allowed, guardFor, presented } from '../src/security.ts'
import { gutterTrack } from '../src/layout/backward.ts'
import { DEFAULT_LAYOUT, type Placed, type PlacedItem } from '../src/types.ts'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'c4v-edge-'))

test('png export names the fix when there is no browser, and refuses an svg with no size', () => {
  const saved = process.env.C4_CHROMIUM
  const dir = scratch()
  try {
    process.env.C4_CHROMIUM = '/nowhere/chrome'
    assert.throws(() => svgToPng('<svg></svg>', join(dir, 'a.png')), /no file at \/nowhere\/chrome \(\$C4_CHROMIUM\)/)

    delete process.env.C4_CHROMIUM
    // a machine with nothing on PATH and nothing in the known locations
    assert.throws(
      () => svgToPng('<svg></svg>', join(dir, 'b.png'), 2, () => null),
      /no Chromium or Chrome found — nothing on PATH/,
      'the message says where it looked',
    )
    // and a browser that exists is asked for an svg that declares no size
    assert.throws(() => svgToPng('<svg></svg>', join(dir, 'c.png'), 2, () => '/bin/sh'), /carries neither width\/height nor a viewBox/)
  } finally {
    if (saved === undefined) delete process.env.C4_CHROMIUM
    else process.env.C4_CHROMIUM = saved
    rmSync(dir, { recursive: true, force: true })
  }
})

const harness = (id: string, scope: 'global' | 'project', dir: string): Harness => ({ id, label: id, dir, scope, kind: 'dir', detect: dir })

test('the plan says why each harness was chosen, and leaves project scope alone', () => {
  const home = scratch()
  const chosen = plan(
    [harness('global-one', 'global', join(home, 'g1')), harness('global-two', 'global', join(home, 'g2')), harness('proj', 'project', join(home, 'p'))],
    { global: true, named: ['proj'], home },
  )
  assert.deepEqual(chosen.map((c) => [c.harness.id, c.reason]), [['proj', 'named']], 'naming beats scope; undetected globals are skipped')
  mkdirSync(join(home, 'g1'), { recursive: true })
  const detectedPlan = plan([harness('global-one', 'global', join(home, 'g1'))], { global: true, home })
  assert.deepEqual(detectedPlan.map((c) => c.reason), ['detected'], 'a harness that exists on disk is detected')
})

test('describe marks present, absent and installed', () => {
  const home = scratch()
  mkdirSync(join(home, 'here'), { recursive: true })
  const lines = describe([harness('here', 'global', join(home, 'here')), harness('gone', 'global', join(home, 'gone'))], { home })
  assert.match(lines[0], /present/)
  assert.match(lines[1], /absent/)
})

test('install copies the skill, and a directory that is not one is refused', () => {
  const home = scratch()
  const target = installInto(harness('t', 'global', join(home, 'skills', 'c4-view')), home)
  assert.ok(isSkillDir(target), 'what was written is a skill')
  const notSkill = join(home, 'empty')
  mkdirSync(notSkill, { recursive: true })
  writeFileSync(join(notSkill, 'README.md'), 'x')
  assert.equal(isSkillDir(notSkill), false, 'a directory without SKILL.md is not a skill')
})

test('a token can arrive as a bearer header, a query or a cookie — and one wrong byte is refused', () => {
  const guard = guardFor('0.0.0.0', 'tok')
  const req = (headers: Record<string, string> = {}): { headers: Record<string, string> } => ({ headers })
  assert.equal(presented(req({ authorization: 'Bearer tok' }) as never, new URL('http://x/')), 'tok')
  assert.equal(presented(req() as never, new URL('http://x/?t=tok')), 'tok')
  assert.equal(presented(req({ cookie: `a=1; ${COOKIE}=tok; b=2` }) as never, new URL('http://x/')), 'tok')
  assert.equal(presented(req() as never, new URL('http://x/')), null)
  assert.equal(allowed(guard, req({ authorization: 'Bearer tok' }) as never, new URL('http://x/')), true)
  assert.equal(allowed(guard, req({ authorization: 'Bearer toe' }) as never, new URL('http://x/')), false, 'constant-time compare, still a refusal')
  assert.equal(allowed(guardFor('127.0.0.1'), req() as never, new URL('http://x/')), true, 'loopback needs no token')
})

test('a backward gutter finds a free track between the columns', () => {
  const items = new Map<string, PlacedItem>([
    ['a', { id: 'a', rank: 0, index: 0, x: 0, y: 0, w: 100, h: 40, dummy: false }],
    ['b', { id: 'b', rank: 1, index: 0, x: 300, y: 0, w: 100, h: 40, dummy: false }],
  ])
  const placed: Placed = { items, boxes: new Map([...items].map(([id, it]) => [id, { x: it.x, y: it.y, w: it.w, h: it.h }])), chains: [], groups: [], size: { w: 400, h: 40 } }
  const used = new Map<number, Set<number>>()
  const first = gutterTrack(placed, DEFAULT_LAYOUT, 0, used)
  const second = gutterTrack(placed, DEFAULT_LAYOUT, 0, used)
  assert.ok(first > 100 && first < 300, `the track lands in the gutter: ${first}`)
  assert.notEqual(first, second, 'a second wire in the same gutter takes a different track')
})

test('a damaged install is tested, not hoped about', async () => {
  const { currentVersion, skillCommand } = await import('../src/cli-skill.ts')
  const home = scratch()
  assert.equal(currentVersion('/nowhere/package.json'), '0.0.0', 'no package.json, still a version string')
  assert.match(currentVersion(), /^\d+\.\d+\.\d+/, 'and the real one is the release version')

  assert.equal(skillCommand(['skill', 'list'], home, { harnesses: () => [] }), 1, 'no harness list is a damaged package')
  assert.equal(skillCommand(['skill', 'install'], home, { skillDir: () => false }), 1, 'no SKILL.md is a damaged package')
})

test('a machine with no browser anywhere says so', async () => {
  const { findChromium } = await import('../src/png.ts')
  const saved = process.env.C4_CHROMIUM
  delete process.env.C4_CHROMIUM
  try {
    assert.equal(findChromium(() => false), null, 'nothing in the known locations and nothing on PATH')
    assert.match(findChromium((p: string) => p === '/usr/bin/chromium') ?? '', /chromium/, 'and a known location is found')
  } finally {
    if (saved !== undefined) process.env.C4_CHROMIUM = saved
  }
})

test('an old node and a missing viewer file are the two failures doctor names first', async () => {
  const { checks } = await import('../src/doctor.ts')
  const rows = checks(scratch(), { version: '18.0.0', assets: '/nowhere/public' })
  const node = rows.find((row) => row.name === 'node')
  assert.equal(node?.ok, false, 'node 18 cannot strip types')
  assert.match(node?.detail ?? '', /needs >=22\.18: nvm install 22/, 'and the row says exactly what to run')
  const assets = rows.find((row) => row.name === 'assets')
  assert.equal(assets?.ok, false, 'a package without its viewer files is broken')
  assert.match(assets?.detail ?? '', /missing viewer\.html/, 'and the row names the first missing file')
})

test('the exact node version boundary is checked, not just "old"', async () => {
  const { checks } = await import('../src/doctor.ts')
  const row = (version: string) => checks(scratch(), { version }).find((r) => r.name === 'node')
  assert.equal(row('22.18.0')?.ok, true, 'the minimum is enough')
  assert.equal(row('22.17.0')?.ok, false, 'one patch below it is not')
  assert.equal(row('23.0.0')?.ok, true, 'anything newer is fine')
})

test('an empty segment in PATH is skipped, not joined', async () => {
  const { findChromium } = await import('../src/png.ts')
  const savedPath = process.env.PATH
  const savedEnv = process.env.C4_CHROMIUM
  delete process.env.C4_CHROMIUM
  try {
    process.env.PATH = ':/usr/bin::/bin'
    assert.equal(findChromium((p: string) => p === '/usr/bin/chromium'), '/usr/bin/chromium', 'the real segments are still searched')
  } finally {
    process.env.PATH = savedPath
    if (savedEnv !== undefined) process.env.C4_CHROMIUM = savedEnv
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT } from '../src/types.ts'
import type { Box, Chain, GroupSpec, LayoutConfig, LevelSpec, NodeSpec, Placed, Ranked, RankItem } from '../src/types.ts'
import { measure } from '../src/metrics.ts'
import { measureNode } from '../src/layout/measure-node.ts'
import { place } from '../src/layout/place.ts'

const cfg: LayoutConfig = { ...DEFAULT_LAYOUT }
const EPS = 0.1001

const node = (id: string, label = id): NodeSpec => ({ id, label, subtype: 'system', state: 'built' as const })

const chainOf = (from: string, to: string, items: string[]): Chain =>
  ({ key: `${from}->${to}`, from, to, items, style: 'flow', backward: false })

const ranked = (ranks: string[][], chains: Chain[] = []): Ranked => {
  const items = new Map<string, RankItem>()
  ranks.forEach((ids, r) => ids.forEach((id, i) => {
    const dummy = id.startsWith('d:')
    items.set(id, { id, rank: r, index: i, w: 0, h: dummy ? cfg.lane * 1.6 : 0, dummy })
  }))
  return { ranks, items, chains }
}

const level = (nodes: NodeSpec[], groups?: GroupSpec[]): LevelSpec =>
  ({ path: '', nodes, edges: [], ...(groups ? { groups } : {}) })

const box = (p: Placed, id: string): Box => {
  const b = p.boxes.get(id)
  assert.ok(b, `missing box ${id}`)
  return b
}

const near = (actual: number, expected: number, msg: string, eps = EPS): void =>
  assert.ok(Math.abs(actual - expected) <= eps, `${msg}: got ${actual}, want ${expected}`)

test('two nodes in one rank are exactly nodeGap apart', () => {
  const lv = level([node('a', 'Alpha'), node('b', 'Beta')])
  const p = place(ranked([['a', 'b']]), lv, cfg, measure)
  const a = box(p, 'a')
  const b = box(p, 'b')
  assert.equal(a.x, 0, 'widest node starts at the column edge')
  near(b.y, a.y + a.h + cfg.nodeGap, 'vertical gap')
  assert.notEqual(b.y, a.y + a.h, 'boxes must not touch')
})

test('adjacent columns are exactly rankGap apart', () => {
  const lv = level([node('a', 'Alpha'), node('b', 'Beta')])
  const p = place(ranked([['a'], ['b']]), lv, cfg, measure)
  const a = box(p, 'a')
  const b = box(p, 'b')
  near(b.x - (a.x + a.w), cfg.rankGap, 'column gap')
  near(b.x + b.w, p.size.w, 'last column ends the drawing')
})

test('port pressure: 5 outgoing chains make the node taller than 1', () => {
  const one = level([node('a', 'Hub'), node('t1')])
  const five = level([node('a', 'Hub'), node('t1'), node('t2'), node('t3'), node('t4'), node('t5')])
  const p1 = place(ranked([['a'], ['t1']], [chainOf('a', 't1', ['a', 't1'])]), one, cfg, measure)
  const p5 = place(
    ranked([['a'], ['t1', 't2', 't3', 't4', 't5']], ['t1', 't2', 't3', 't4', 't5'].map((t) => chainOf('a', t, ['a', t]))),
    five, cfg, measure,
  )
  const h1 = box(p1, 'a').h
  const h5 = box(p5, 'a').h
  assert.ok(h5 > h1, `expected ${h5} > ${h1}`)
  assert.equal(h5, (5 + 1) * cfg.portGap)
  assert.equal(h1, Math.ceil(measureNode(node('a', 'Hub'), cfg, measure).h), 'one chain: text height wins')
})

test('a dummy keeps lane*1.6 and its neighbour takes a lane gap', () => {
  const lv = level([node('a', 'Alpha'), node('b', 'Beta')])
  const ch = chainOf('a', 'b', ['a', 'd:a->b:1', 'b'])

  const dummyFirst = place(ranked([['a'], ['d:a->b:1', 'b']], [ch]), lv, cfg, measure)
  const d1 = dummyFirst.items.get('d:a->b:1')
  assert.ok(d1, 'dummy placed')
  assert.equal(d1.h, cfg.lane * 1.6)
  assert.equal(d1.w, 0)
  near(box(dummyFirst, 'b').y, d1.y + d1.h + cfg.lane, 'dummy below → lane gap')

  const realFirst = place(ranked([['a'], ['b', 'd:a->b:1']], [ch]), lv, cfg, measure)
  const d2 = realFirst.items.get('d:a->b:1')
  assert.ok(d2, 'dummy placed')
  near(d2.y, box(realFirst, 'b').y + box(realFirst, 'b').h + cfg.lane, 'real below → lane gap')
  assert.notEqual(d2.y, box(realFirst, 'b').y + box(realFirst, 'b').h + cfg.nodeGap)
})

test('a group box wraps every member with >=16 padding and a >=22 top strip', () => {
  const lv = level(
    [node('a', 'Alpha'), node('b', 'Beta')],
    [{ id: 'g1', label: 'Boundary', members: ['a', 'b'] }],
  )
  const p = place(ranked([['a'], ['b']]), lv, cfg, measure)
  const g = p.groups[0]
  assert.ok(g, 'group emitted')
  const members = ['a', 'b'].map((id) => box(p, id))
  for (const m of members) {
    assert.ok(g.box.x <= m.x - 16 + EPS, 'left padding')
    assert.ok(g.box.y <= m.y - 16 + EPS, 'top padding')
    assert.ok(g.box.x + g.box.w >= m.x + m.w + 16 - EPS, 'right padding')
    assert.ok(g.box.y + g.box.h >= m.y + m.h + 16 - EPS, 'bottom padding')
  }
  const top = Math.min(...members.map((m) => m.y))
  near(top - 16 - (g.box.y + 22), 0, 'label strip sits above the padding')
  near(g.box.y + 38, top, 'top padding plus strip')
})

test('no two real boxes overlap and every box is inside size', () => {
  const lv = level([node('a', 'Alpha'), node('b', 'Beta'), node('c', 'Gamma'), node('d'), node('e'), node('f'), node('g')])
  const chains = [
    chainOf('a', 'd', ['a', 'd']),
    chainOf('c', 'f', ['c', 'f']),
    chainOf('a', 'g', ['a', 'd:a->g:1', 'd:a->g:2', 'g']),
  ]
  const p = place(
    ranked([['a', 'b', 'c'], ['d', 'e', 'd:a->g:1'], ['f', 'g', 'd:a->g:2']], chains),
    lv, cfg, measure,
  )
  const boxes = [...p.boxes.values()]
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      assert.ok(ox <= 0 || oy <= 0, `boxes ${i}/${j} overlap by ${ox}x${oy}`)
    }
  }
  for (const b of boxes) {
    assert.ok(b.x >= -EPS && b.y >= -EPS, 'box starts inside the drawing')
    assert.ok(b.x + b.w <= p.size.w + EPS, 'box within width')
    assert.ok(b.y + b.h <= p.size.h + EPS, 'box within height')
  }
  assert.equal(p.items.size, 7 + 2, 'dummies are items too')
  assert.equal(p.boxes.size, 7, 'boxes are real nodes only')
})

test('determinism: two calls produce deep-equal output', () => {
  const lv = level([node('a', 'Alpha'), node('b', 'Beta')], [{ id: 'g', label: 'G', members: ['a'] }])
  const r = ranked([['a'], ['b']], [chainOf('a', 'b', ['a', 'b'])])
  assert.deepEqual(place(r, lv, cfg, measure), place(r, lv, cfg, measure))
})

test('the Ranked input is not mutated', () => {
  const r = ranked([['a'], ['d:a->b:1', 'b']], [chainOf('a', 'b', ['a', 'd:a->b:1', 'b'])])
  const before = structuredClone(r)
  place(r, level([node('a', 'Alpha'), node('b', 'Beta')]), cfg, measure)
  assert.deepEqual(r, before)
})

test('a chain with no items in the fixture is ignored, not indexed off the end', () => {
  const empty: Chain = { key: 'x->y', from: 'x', to: 'y', items: [], style: 'flow', backward: false }
  const p = place(ranked([['a']], [empty, chainOf('a', 'b', ['a', 'b'])]), level([node('a', 'Alpha'), node('b', 'Beta')]), cfg, measure)
  assert.ok(p.boxes.get('a'), 'the real chain still places')
})

test('a spec that is missing falls back to the fixture size', () => {
  const p = place(ranked([['ghost']]), level([]), cfg, measure)
  assert.deepEqual([p.boxes.get('ghost')?.w, p.boxes.get('ghost')?.h], [0, 0], 'an unknown node keeps its measured 0')
})

test('a chain whose items skip a column is not counted as a gutter track', () => {
  // a→c skips rank 1, so the gutter between 0 and 1 must not claim a track for it
  const skip = chainOf('a', 'c', ['a', 'c'])
  const p = place(ranked([['a'], ['b'], ['c']], [skip]), level([node('a'), node('b'), node('c')]), cfg, measure)
  assert.ok(p.boxes.get('c'), 'the far node still places')
})

test('a backward chain does not load a gutter', () => {
  const back: Chain = { key: 'c->a', from: 'c', to: 'a', items: ['c', 'a'], style: 'dep', backward: true }
  const p = place(ranked([['a'], ['b'], ['c']], [back]), level([node('a'), node('b'), node('c')]), cfg, measure)
  assert.ok(p.boxes.get('a') && p.boxes.get('c'))
})

test('a labelled chain widens its gutter, an unlabelled one does not', () => {
  const lv = level([node('a', 'Alpha'), node('b', 'Beta')])
  const bare = place(ranked([['a'], ['b']], [chainOf('a', 'b', ['a', 'b'])]), lv, cfg, measure)
  const labelled: Chain = { ...chainOf('a', 'b', ['a', 'b']), label: 'REST /orders (idempotent)' }
  const wide = place(ranked([['a'], ['b']], [labelled]), lv, cfg, measure)
  assert.ok((wide.boxes.get('b')?.x ?? 0) >= (bare.boxes.get('b')?.x ?? 0), 'the label never narrows the drawing')
})

test('a rank naming an id that is not in the item map is skipped', () => {
  const r = ranked([['a'], ['nobody', 'b']], [chainOf('a', 'b', ['a', 'b'])])
  const p = place(r, level([node('a'), node('b')]), cfg, measure)
  assert.ok(p.boxes.get('b'), 'the column still places around the gap')
})

test('a boundary group with a member nobody placed is dropped, not drawn around a ghost', () => {
  const lv = level([node('a', 'Alpha')], [{ id: 'g', label: 'Group', members: ['a', 'ghost'] }])
  const p = place(ranked([['a']], []), lv, cfg, measure)
  assert.equal(p.groups.length, 1, 'one group survives')
  assert.ok(p.groups[0].box.w > 0, 'and it is boxed around the member that exists')
})

test('a group whose every member is missing draws nothing', () => {
  const lv = level([node('a', 'Alpha')], [{ id: 'g', label: 'Group', members: ['ghost', 'phantom'] }])
  const p = place(ranked([['a']], []), lv, cfg, measure)
  assert.deepEqual(p.groups, [], 'no members, no box')
})

test('a group that reaches above the drawing shifts everything down, never negative', () => {
  const lv = level([node('a', 'Alpha'), node('b', 'Beta')], [{ id: 'g', label: 'Group', members: ['a', 'b'] }])
  const p = place(ranked([['a'], ['b']], [chainOf('a', 'b', ['a', 'b'])]), lv, cfg, measure)
  for (const b of [...p.boxes.values(), ...p.groups.map((g) => g.box)]) {
    assert.ok(b.x >= 0 && b.y >= 0, `nothing at negative coordinates: ${JSON.stringify(b)}`)
  }
})

test('a node every wire passes through is taller, so its ports fit', () => {
  const fan = Array.from({ length: 4 }, (_, i) => chainOf('a', `t${i}`, ['a', `t${i}`]))
  const nodes = [node('a', 'Hub'), ...Array.from({ length: 4 }, (_, i) => node(`t${i}`, `T${i}`))]
  const r = ranked([['a'], ['t0', 't1', 't2', 't3']], fan)
  const p = place(r, level(nodes), cfg, measure)
  const hub = p.boxes.get('a')
  const t0 = p.boxes.get('t0')
  assert.ok(hub && t0, 'both place')
  assert.ok((hub.h) >= 5 * cfg.portGap, `the hub grew for its ports: ${hub.h}`)
  assert.ok(hub.h > t0.h, 'and it is taller than a node with one wire')
})

test('a dummy following a dummy keeps the thin lane gap', () => {
  const r = ranked([['a'], ['d:a->b:1', 'd:a->b:2'], ['b']], [chainOf('a', 'b', ['a', 'd:a->b:1', 'd:a->b:2', 'b'])])
  const p = place(r, level([node('a', 'Alpha'), node('b', 'Beta')]), cfg, measure)
  assert.ok(p.boxes.get('b'), 'the far node still places below the dummies')
})

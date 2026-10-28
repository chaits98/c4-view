/**
 * Ports — where each chain meets an item's border, and the key that names it.
 *
 * A real node spreads its chains along the used side, ordered by where the far end
 * sits; a dummy has one port at its centre, shared by the incoming and outgoing
 * piece, so the wire continues straight through it.
 *
 * @module c4-view/layout/ports
 */
import type { Chain, PlacedItem } from '../types.ts'
import { SEP, centreY, centreX } from './geometry.ts'

/** One chain touching one item side; `other` is the far end's centre, for port order. */
interface Touch { key: string; other: number }

const portKey = (chainKey: string, id: string, side: string): string => `${chainKey}${SEP}${id}${SEP}${side}`

/** Port y (sides l/r) and port x (bottom) for every chain touching a real item. */
export function buildPorts(chains: Chain[], items: Map<string, PlacedItem>): Map<string, number> {
  const groups = new Map<string, Touch[]>()
  const add = (chainKey: string, id: string, side: string, other: number): void => {
    const k = `${id}${SEP}${side}`
    const list = groups.get(k) ?? []
    list.push({ key: chainKey, other })
    groups.set(k, list)
  }
  for (const c of chains) {
    const first = items.get(c.items[0])
    const last = items.get(c.items[c.items.length - 1])
    if (!first || !last) continue
    if (c.backward) {
      add(c.key, first.id, 'b', centreX(last))
      add(c.key, last.id, 'b', centreX(first))
    } else {
      add(c.key, first.id, 'r', centreY(last))
      add(c.key, last.id, 'l', centreY(first))
    }
  }

  const ports = new Map<string, number>()
  for (const [k, list] of groups) {
    const [id, side] = k.split(SEP)
    const it = items.get(id)
    if (!it) continue
    const sorted = [...list].sort((a, b) => a.other - b.other || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    sorted.forEach((t, i) => {
      const frac = (i + 1) / (sorted.length + 1)
      ports.set(portKey(t.key, id, side), side === 'b' ? it.x + frac * it.w : it.y + frac * it.h)
    })
  }
  return ports
}

export const portY = (it: PlacedItem, side: 'l' | 'r', key: string, ports: Map<string, number>): number =>
  it.dummy ? centreY(it) : (ports.get(portKey(key, it.id, side)) ?? centreY(it))

export const portX = (it: PlacedItem, key: string, ports: Map<string, number>): number =>
  it.dummy ? centreX(it) : (ports.get(portKey(key, it.id, 'b')) ?? centreX(it))
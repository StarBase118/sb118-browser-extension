import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: {
    get: vi.fn(async (k: string) => ({ [k]: store[k] })),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
  } } },
}))

import {
  getCachedItems,
  getLastSeen,
  setCachedCount,
  setCachedItems,
  setLastSeen,
} from '@/lib/notifications-store'

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('notifications store', () => {
  it('defaults last-seen markers to an empty object', async () => {
    expect(await getLastSeen()).toEqual({})
  })

  it('round-trips last-seen markers', async () => {
    await setLastSeen({ announcements: '2026-08-07T16:00:00.000Z' })
    expect(await getLastSeen()).toEqual({ announcements: '2026-08-07T16:00:00.000Z' })
  })

  it('ignores malformed last-seen storage', async () => {
    store.notifLastSeen = { announcements: 12, other: '2026-08-07T16:00:00.000Z' }
    expect(await getLastSeen()).toEqual({})
  })

  // notifCount is write-only now — the badge is set from the count the worker
  // just computed, and the getter's only reader was the deleted explainer.
  it('writes the cached count for the worker', async () => {
    await setCachedCount(4)
    expect(store.notifCount).toBe(4)
  })
})

describe('cached items', () => {
  it('returns null when nothing has been stored', async () => {
    expect(await getCachedItems()).toBeNull()
  })

  // Load-bearing: an empty payload is "we looked and it was quiet", which the
  // popup renders differently from "we have not looked".
  it('round-trips a valid but empty payload as empty, not null', async () => {
    await setCachedItems({})
    expect(await getCachedItems()).toEqual({})
  })

  it('round-trips a populated payload', async () => {
    const payload = {
      news: { items: [{ id: '1', title: 'A', url: 'https://x/1', at: '2026-08-13T10:00:00Z' }] },
    }
    await setCachedItems(payload)
    expect(await getCachedItems()).toEqual(payload)
  })

  it('keeps an unavailable flag', async () => {
    await setCachedItems({ sims: { items: [], unavailable: true } })
    expect((await getCachedItems())!.sims!.unavailable).toBe(true)
  })

  it.each([
    ['a string', 'nope'],
    ['an array', [1, 2]],
    ['a group that is not an object', { news: 'nope' }],
    ['items that are not an array', { news: { items: 'nope' } }],
    ['an item missing url', { news: { items: [{ id: '1', title: 'A', at: '2026-08-13T10:00:00Z' }] } }],
  ])('returns null for %s', async (_label, value) => {
    store.notifItems = value
    expect(await getCachedItems()).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: {
    get: vi.fn(async (k: string) => ({ [k]: store[k] })),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
  } } },
}))

import {
  addClicked,
  clickedKey,
  getCachedCount,
  getCachedItems,
  getClicked,
  getLastSeen,
  pruneClicked,
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

  it('defaults cached count to zero', async () => {
    expect(await getCachedCount()).toBe(0)
  })

  it('round-trips cached count', async () => {
    await setCachedCount(4)
    expect(await getCachedCount()).toBe(4)
  })

  it('ignores malformed cached count storage', async () => {
    store.notifCount = '4'
    expect(await getCachedCount()).toBe(0)
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

describe('clicked keys', () => {
  it('keys by source and id, never the bare id', () => {
    expect(clickedKey('announcements', '1')).toBe('announcements:1')
    expect(clickedKey('news', '1')).toBe('news:1')
    expect(clickedKey('announcements', '1')).not.toBe(clickedKey('news', '1'))
  })

  it('defaults to an empty list', async () => {
    expect(await getClicked()).toEqual([])
  })

  it('round-trips a clicked key', async () => {
    await addClicked('sims:42')
    expect(await getClicked()).toEqual(['sims:42'])
  })

  it('stores a repeated key once', async () => {
    await addClicked('sims:42')
    await addClicked('sims:42')
    expect(await getClicked()).toEqual(['sims:42'])
  })

  // A half-written or hand-edited value must not throw on read; the member
  // simply sees rows they had dismissed, which is recoverable by clicking again.
  it('ignores malformed clicked storage', async () => {
    store.notifClicked = 'sims:42'
    expect(await getClicked()).toEqual([])
    store.notifClicked = ['sims:42', 7]
    expect(await getClicked()).toEqual([])
  })
})

describe('pruning clicked keys', () => {
  const healthy = {
    announcements: { items: [{ id: '1', title: 'a', url: 'u', at: '2026-08-20T00:00:00.000Z' }] },
    sims: { items: [{ id: '9', title: 's', url: 'u', at: '2026-08-20T00:00:00.000Z' }] },
  }

  it('drops a key whose item is gone and keeps one that is still there', async () => {
    store.notifClicked = ['announcements:1', 'announcements:99']
    await pruneClicked(healthy)
    expect(await getClicked()).toEqual(['announcements:1'])
  })

  // THE outage case. A source that failed says nothing about what the member
  // dismissed; deleting its keys makes every dismissed row reappear when it
  // recovers.
  it('keeps every key of a source flagged unavailable', async () => {
    store.notifClicked = ['announcements:1', 'announcements:99', 'sims:404']
    await pruneClicked({
      announcements: { items: [], unavailable: true },
      sims: { items: [{ id: '9', title: 's', url: 'u', at: '2026-08-20T00:00:00.000Z' }] },
    })
    expect((await getClicked()).sort()).toEqual(['announcements:1', 'announcements:99'])
  })

  it('keeps every key of a source missing from the payload', async () => {
    store.notifClicked = ['news:5', 'sims:9']
    await pruneClicked(healthy)
    expect((await getClicked()).sort()).toEqual(['news:5', 'sims:9'])
  })

  it('drops keys of a healthy source that is simply empty', async () => {
    store.notifClicked = ['sims:9']
    await pruneClicked({ sims: { items: [] } })
    expect(await getClicked()).toEqual([])
  })

  it('leaves storage alone when nothing needs dropping', async () => {
    store.notifClicked = ['announcements:1']
    await pruneClicked(healthy)
    expect(await getClicked()).toEqual(['announcements:1'])
  })
})

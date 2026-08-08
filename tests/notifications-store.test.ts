import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: {
    get: vi.fn(async (k: string) => ({ [k]: store[k] })),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
  } } },
}))

import { getCachedCount, getLastSeen, setCachedCount, setLastSeen } from '@/lib/notifications-store'

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

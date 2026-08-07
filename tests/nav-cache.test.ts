import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: {
    get: vi.fn(async (k: string) => ({ [k]: store[k] })),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
    remove: vi.fn(async (k: string) => { delete store[k] }),
  } } },
}))

import { getNav, setNav, clearNav, syncNavCache, type NavEntry } from '@/lib/nav-cache'

const NAV: NavEntry[] = [{ label: 'Votes', path: '/votes', category: 'Council' }]

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('nav cache', () => {
  it('defaults to an empty list', async () => {
    expect(await getNav()).toEqual([])
  })

  it('round-trips', async () => {
    await setNav(NAV)
    expect(await getNav()).toEqual(NAV)
  })

  it('ignores a stored value of the wrong shape', async () => {
    store.navCache = [{ nope: 1 }]
    expect(await getNav()).toEqual([])
  })

  it('clears', async () => {
    await setNav(NAV)
    await clearNav()
    expect(await getNav()).toEqual([])
  })
})

describe('syncNavCache', () => {
  // The cache outlives the popup. Without this, signing out (or a session
  // expiring) would leave the previous session's page list on screen and
  // matchable.
  it('clears the cache when there is no authenticated profile', async () => {
    await setNav(NAV)
    expect(await syncNavCache(null)).toEqual([])
    expect(await getNav()).toEqual([])
  })

  // Group membership changes between sessions, so a merge would keep pages
  // the caller has since lost access to.
  it('replaces wholesale rather than merging', async () => {
    await setNav([
      { label: 'Votes', path: '/votes', category: 'Council' },
      { label: 'Finance', path: '/finance', category: 'EC' },
    ])
    expect(await syncNavCache({ nav: NAV })).toEqual(NAV)
    expect(await getNav()).toEqual(NAV)
  })

  // An older megatool deploy has no nav[] on /api/me; the popup still works,
  // it just has no destinations to match.
  it('treats a profile without nav[] as an empty list', async () => {
    await setNav(NAV)
    expect(await syncNavCache({})).toEqual([])
  })
})

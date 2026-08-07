import { describe, it, expect, vi } from 'vitest'
import { runSearch, pendingSources, type SearchContext } from '@/lib/search'
import type { SearchGroup } from '@/lib/search-types'
import type { NavEntry } from '@/lib/nav-cache'

const NAV: NavEntry[] = [{ label: 'Open votes', path: '/votes/open', category: 'Council' }]

const ctx = (over: Partial<SearchContext> = {}): SearchContext => ({
  signedIn: true,
  isStaff: false,
  nav: NAV,
  ...over,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch stub that answers each host with a canned body. */
function router(routes: Record<string, () => Promise<Response>>) {
  return vi.fn(async (url: string) => {
    for (const [needle, handler] of Object.entries(routes)) {
      if (url.includes(needle)) return handler()
    }
    throw new Error(`unrouted: ${url}`)
  }) as unknown as typeof fetch
}

const OK = {
  'wiki.starbase118.net': async () => json({ query: { search: [{ title: 'W', snippet: '' }] } }),
  'www.starbase118.net': async () =>
    json({ groups: [{ source: 'news', hits: [], seeAllUrl: null }] }),
  'hq.starbase118.net': async () =>
    json({ groups: [{ source: 'forum', hits: [], seeAllUrl: null }] }),
}

async function collect(query: string, c: SearchContext, fetchFn: typeof fetch, signal?: AbortSignal) {
  const groups: SearchGroup[] = []
  await runSearch(query, c, { fetchFn, signal, onGroup: (g) => groups.push(g) })
  return groups
}

describe('pendingSources', () => {
  it('is empty for a blank query', () => {
    expect(pendingSources('   ', ctx())).toEqual([])
  })

  it('is destinations only below the remote minimum', () => {
    expect(pendingSources('v', ctx())).toEqual(['destination'])
  })

  it('adds the forum only for signed-in staff', () => {
    expect(pendingSources('vo', ctx())).not.toContain('forum')
    expect(pendingSources('vo', ctx({ isStaff: true }))).toContain('forum')
    expect(pendingSources('vo', ctx({ isStaff: true, signedIn: false }))).not.toContain('forum')
  })

  it('drops destinations when there is no cached page list', () => {
    expect(pendingSources('vo', ctx({ nav: [] }))).not.toContain('destination')
  })
})

describe('runSearch', () => {
  it('emits destinations before any request is made', async () => {
    const order: string[] = []
    const fetchFn = router(OK)
    await runSearch('vote', ctx(), {
      fetchFn,
      onGroup: (g) => order.push(g.source),
    })
    expect(order[0]).toBe('destination')
  })

  it('does not fire the network sources on a single character', async () => {
    const fetchFn = router(OK)
    const groups = await collect('v', ctx(), fetchFn)
    expect(groups.map((g) => g.source)).toEqual(['destination'])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('does nothing at all for a query that trims to empty', async () => {
    const fetchFn = router(OK)
    expect(await collect('   ', ctx(), fetchFn)).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('skips the forum request entirely for a non-staff caller', async () => {
    const fetchFn = router(OK)
    const groups = await collect('vote', ctx(), fetchFn)
    expect(groups.map((g) => g.source)).not.toContain('forum')
    const called = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0])
    expect(called.some((u) => u.includes('/api/search/forum'))).toBe(false)
  })

  it('queries the forum for signed-in staff', async () => {
    const fetchFn = router(OK)
    const groups = await collect('vote', ctx({ isStaff: true }), fetchFn)
    expect(groups.map((g) => g.source)).toContain('forum')
  })

  // One dead source must not take the others down with it.
  it('isolates a per-source failure', async () => {
    const fetchFn = router({
      ...OK,
      'wiki.starbase118.net': async () => { throw new Error('offline') },
    })
    const groups = await collect('vote', ctx(), fetchFn)
    const wiki = groups.find((g) => g.source === 'wiki')!
    expect(wiki.unavailable).toBe(true)
    expect(groups.find((g) => g.source === 'news')?.unavailable).toBeUndefined()
    expect(groups.find((g) => g.source === 'destination')).toBeDefined()
  })

  // The whole point of the abort: a slow response for "vo" must never land on
  // top of the results for "vote".
  it('emits nothing once the caller has aborted', async () => {
    const controller = new AbortController()
    const fetchFn = router(OK)
    const groups: SearchGroup[] = []
    const done = runSearch('vote', ctx(), {
      fetchFn,
      signal: controller.signal,
      onGroup: (g) => groups.push(g),
    })
    // destinations are emitted synchronously, before the abort lands
    expect(groups.map((g) => g.source)).toEqual(['destination'])
    controller.abort()
    await done
    expect(groups.map((g) => g.source)).toEqual(['destination'])
  })

  it('resolves even when every source fails', async () => {
    const fetchFn = router({
      'wiki.starbase118.net': async () => { throw new Error('x') },
      'www.starbase118.net': async () => { throw new Error('x') },
    })
    const groups = await collect('vote', ctx(), fetchFn)
    expect(groups.filter((g) => g.unavailable)).toHaveLength(4) // wiki + news/pages/sims
  })
})

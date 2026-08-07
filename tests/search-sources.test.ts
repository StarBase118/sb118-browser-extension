import { describe, it, expect, vi } from 'vitest'
import {
  searchWiki,
  searchMainSite,
  searchForum,
  stripWikiSnippet,
  wikiPageUrl,
} from '@/lib/search-sources'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('stripWikiSnippet', () => {
  it('drops the searchmatch markup MediaWiki wraps hits in', () => {
    expect(stripWikiSnippet('the <span class="searchmatch">Ronin</span> crew')).toBe('the Ronin crew')
  })

  it('decodes entities and collapses whitespace', () => {
    expect(stripWikiSnippet('a &amp; b &quot;c&quot;\n  d')).toBe('a & b "c" d')
  })

  it('decodes &amp; last so &amp;lt; does not become a tag', () => {
    expect(stripWikiSnippet('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;')
  })
})

describe('wikiPageUrl', () => {
  it('underscores spaces', () => {
    expect(wikiPageUrl('Ronin Master Crew List')).toBe(
      'https://wiki.starbase118.net/wiki/Ronin_Master_Crew_List'
    )
  })

  // encodeURIComponent escapes "/", which would break every subpage link.
  it('keeps subpage slashes intact', () => {
    expect(wikiPageUrl('Ronin Master Crew List/Roster')).toBe(
      'https://wiki.starbase118.net/wiki/Ronin_Master_Crew_List/Roster'
    )
  })

  it('escapes characters that would break the url', () => {
    expect(wikiPageUrl('A?b')).toContain('%3F')
  })
})

describe('searchWiki', () => {
  it('normalizes MediaWiki results into the shared hit shape', async () => {
    const fetchFn = vi.fn(async () =>
      json({ query: { search: [{ title: 'USS Ronin', snippet: 'a <span>ship</span>' }] } })
    )
    const g = await searchWiki('ronin', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(g.hits).toEqual([
      {
        source: 'wiki',
        title: 'USS Ronin',
        snippet: 'a ship',
        url: 'https://wiki.starbase118.net/wiki/USS_Ronin',
      },
    ])
    expect(g.seeAllUrl).toBe('https://wiki.starbase118.net/w/index.php?search=ronin')
    expect(g.unavailable).toBeUndefined()
  })

  it('reports unavailable — not empty — when the request fails', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline') })
    const g = await searchWiki('ronin', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(g.unavailable).toBe(true)
    expect(g.hits).toEqual([])
    // still linkable — the member can go run the search themselves
    expect(g.seeAllUrl).toContain('search=ronin')
  })

  it('reports unavailable on a non-200', async () => {
    const fetchFn = vi.fn(async () => json({}, 503))
    expect((await searchWiki('x', { fetchFn: fetchFn as unknown as typeof fetch })).unavailable).toBe(true)
  })

  it('times out rather than hanging a group forever', async () => {
    const fetchFn = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))
        })
    )
    const g = await searchWiki('x', { fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 10 })
    expect(g.unavailable).toBe(true)
  })
})

describe('searchMainSite', () => {
  it('passes the server envelope through and caps each group', async () => {
    const hit = (i: number) => ({ source: 'news', title: `n${i}`, snippet: null, url: `u${i}` })
    const fetchFn = vi.fn(async () =>
      json({
        groups: [
          { source: 'news', hits: [0, 1, 2, 3, 4, 5, 6].map(hit), seeAllUrl: null },
          { source: 'sims', hits: [], seeAllUrl: null },
        ],
      })
    )
    const groups = await searchMainSite('x', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(groups.map((g) => g.source)).toEqual(['news', 'sims'])
    expect(groups[0].hits).toHaveLength(5)
  })

  it('fills in a see-all link when the server omits one', async () => {
    const fetchFn = vi.fn(async () => json({ groups: [{ source: 'sims', hits: [], seeAllUrl: null }] }))
    const [sims] = await searchMainSite('wolf', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(sims.seeAllUrl).toBe('https://www.starbase118.net/sims/search/?q=wolf')
  })

  // Track 2 has not shipped, so today this route 404s. All three groups must
  // degrade rather than the search looking like it found nothing.
  it('marks all three groups unavailable when the route does not exist', async () => {
    const fetchFn = vi.fn(async () => json({}, 404))
    const groups = await searchMainSite('x', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(groups.map((g) => g.source)).toEqual(['news', 'pages', 'sims'])
    expect(groups.every((g) => g.unavailable)).toBe(true)
  })

  it('degrades on a malformed body instead of throwing', async () => {
    const fetchFn = vi.fn(async () => json({ nope: true }))
    const groups = await searchMainSite('x', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(groups.every((g) => g.unavailable)).toBe(true)
  })
})

describe('searchForum', () => {
  it('sends the session cookie', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => json({ groups: [] }))
    await searchForum('x', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  // The server answers a non-entitled caller with zero groups, not a 403.
  // "Group absent" means not applicable to this caller, so nothing renders.
  it('renders no forum group when the server returns none', async () => {
    const fetchFn = vi.fn(async () => json({ groups: [] }))
    expect(await searchForum('x', { fetchFn: fetchFn as unknown as typeof fetch })).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { matchDestinations, destinationGroup } from '@/lib/destinations'
import type { NavEntry } from '@/lib/nav-cache'

const NAV: NavEntry[] = [
  { label: 'Roster', path: '/roster', category: 'Fleet' },
  { label: 'Open votes', path: '/votes/open', category: 'Council' },
  { label: 'Votes', path: '/votes', category: 'Council' },
  { label: 'Committee voting record', path: '/votes/record', category: 'Council' },
  { label: 'Orders', path: '/orders', category: 'Fleet' },
  { label: 'Awards', path: 'awards', category: 'Recognition' },
  { label: 'Training queue', path: '/training', category: 'Academy' },
]

describe('matchDestinations', () => {
  it('ranks a label prefix ahead of a word inside the label', () => {
    expect(matchDestinations(NAV, 'vote').map((h) => h.title)).toEqual([
      'Votes',      // the label itself starts with the query
      'Open votes', // a word inside the label starts with it
    ])
  })

  it('ranks a prefix ahead of a mid-word match', () => {
    expect(matchDestinations(NAV, 'ord').map((h) => h.title)).toEqual([
      'Orders',                   // prefix
      'Committee voting record',  // "record" merely contains it
    ])
  })

  it('matches an exact label ahead of a longer prefix match', () => {
    expect(matchDestinations(NAV, 'votes')[0].title).toBe('Votes')
  })

  it('matches from the first character — the list is local', () => {
    expect(matchDestinations(NAV, 'r').map((h) => h.title)).toContain('Roster')
  })

  it('falls back to the category when the label does not match', () => {
    expect(matchDestinations(NAV, 'academy').map((h) => h.title)).toEqual(['Training queue'])
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchDestinations(NAV, '  ROSTER ').map((h) => h.title)).toEqual(['Roster'])
  })

  it('caps the group', () => {
    expect(matchDestinations(NAV, 'o', 2)).toHaveLength(2)
  })

  it('returns nothing for an empty query rather than the whole list', () => {
    expect(matchDestinations(NAV, '   ')).toEqual([])
  })

  it('builds an absolute HQ url, tolerating a path with no leading slash', () => {
    const [hit] = matchDestinations(NAV, 'awards')
    expect(hit.url).toBe('https://hq.starbase118.net/awards')
    expect(hit.source).toBe('destination')
  })
})

describe('destinationGroup', () => {
  // The full list is already local and short — there is nowhere more complete
  // to send someone, so a "see all" link would be a link to nothing better.
  it('carries no see-all link', () => {
    expect(destinationGroup(NAV, 'vote').seeAllUrl).toBeNull()
  })
})

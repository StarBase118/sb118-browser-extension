import type { NavEntry } from '@/lib/nav-cache'
import { HITS_PER_GROUP, type SearchGroup, type SearchHit } from '@/lib/search-types'

export const HQ_BASE = 'https://hq.starbase118.net'

/**
 * Ranking tiers, best first. Typing "vote" should land on a page called
 * "Votes" before one called "Committee voting record", and both before a page
 * that only matches on its category.
 */
function score(entry: NavEntry, q: string): number {
  const label = entry.label.toLowerCase()
  const category = (entry.category ?? '').toLowerCase()
  if (label === q) return 0
  if (label.startsWith(q)) return 1
  // a word inside the label starting with the query ("open Votes")
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 2
  if (label.includes(q)) return 3
  if (category.includes(q)) return 4
  return Number.POSITIVE_INFINITY
}

function toHit(entry: NavEntry): SearchHit {
  const path = entry.path.startsWith('/') ? entry.path : `/${entry.path}`
  return {
    source: 'destination',
    title: entry.label,
    snippet: entry.category || null,
    url: `${HQ_BASE}${path}`,
  }
}

/**
 * Match the cached HQ page list locally. Destinations match from the first
 * character — the list is local and small, so there is no request to save.
 *
 * Ties keep the order `/api/me` returned, which is HQ's own nav order.
 */
export function matchDestinations(
  nav: NavEntry[],
  query: string,
  limit = HITS_PER_GROUP
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return nav
    .map((entry, index) => ({ entry, index, rank: score(entry, q) }))
    .filter((r) => Number.isFinite(r.rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((r) => toHit(r.entry))
}

/**
 * Destinations carry no "see all" link — the full list is already local and
 * short, so there is nowhere more complete to send someone.
 */
export function destinationGroup(nav: NavEntry[], query: string): SearchGroup {
  return { source: 'destination', hits: matchDestinations(nav, query), seeAllUrl: null }
}

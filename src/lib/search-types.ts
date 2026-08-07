/**
 * The shared result shape every search source normalizes to, plus the tuning
 * constants the popup and the sources agree on.
 *
 * Both server routes (`www/api/search` and `hq/api/search/forum`) return the
 * `SearchResponse` envelope directly; the wiki is normalized client-side
 * because MediaWiki returns its own shape with HTML-ish snippets.
 */

export type SearchSource = 'destination' | 'wiki' | 'news' | 'pages' | 'sims' | 'forum'

export interface SearchHit {
  source: SearchSource
  title: string
  snippet: string | null // destinations have none
  url: string
}

export interface SearchGroup {
  source: SearchSource
  hits: SearchHit[]
  seeAllUrl: string | null
  /**
   * True when the source was queried and failed or timed out. A group with
   * `unavailable` is rendered as "<source> unavailable" rather than as an
   * empty result — a search where every source fails must be visibly a
   * failure, not a plausible-looking "no matches".
   */
  unavailable?: boolean
}

export interface SearchResponse {
  groups: SearchGroup[]
}

/** Below this length the three network sources do not fire at all. */
export const MIN_REMOTE_QUERY = 2
export const HITS_PER_GROUP = 5
export const SOURCE_TIMEOUT_MS = 5000
export const DEBOUNCE_MS = 200

export const SOURCE_LABELS: Record<SearchSource, string> = {
  destination: 'Go to',
  wiki: 'Wiki',
  news: 'News',
  pages: 'Pages',
  sims: 'Sims',
  forum: 'Forum',
}

/**
 * Render order. Destinations always sit at the top — they match locally and
 * are the only group that can be correct before any request returns.
 */
export const SOURCE_ORDER: SearchSource[] = ['destination', 'wiki', 'news', 'pages', 'sims', 'forum']

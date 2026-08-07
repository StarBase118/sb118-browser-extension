import {
  HITS_PER_GROUP,
  SOURCE_TIMEOUT_MS,
  type SearchGroup,
  type SearchHit,
  type SearchResponse,
  type SearchSource,
} from '@/lib/search-types'

export const WIKI_BASE = 'https://wiki.starbase118.net'
export const SITE_BASE = 'https://www.starbase118.net'
export const HQ_BASE = 'https://hq.starbase118.net'

/** Injected in tests; defaults to the platform fetch. */
export type FetchLike = typeof fetch

interface SourceOpts {
  signal?: AbortSignal
  fetchFn?: FetchLike
  timeoutMs?: number
}

/**
 * One request with a per-source timeout, chained to the caller's abort signal
 * so a newer keystroke cancels it too.
 *
 * `AbortSignal.any` keeps the two independent: the timeout aborts only this
 * source, the caller's signal aborts every source at once.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  { signal, fetchFn = fetch, timeoutMs = SOURCE_TIMEOUT_MS }: SourceOpts
): Promise<Response> {
  const timer = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timer]) : timer
  return fetchFn(url, { ...init, signal: combined })
}

function unavailable(source: SearchSource, seeAllUrl: string | null): SearchGroup {
  return { source, hits: [], seeAllUrl, unavailable: true }
}

/**
 * MediaWiki snippets arrive as HTML fragments (`<span class="searchmatch">`),
 * so they are stripped rather than rendered — the popup sets textContent and
 * never innerHTML, and a half-escaped fragment would read as noise either way.
 */
export function stripWikiSnippet(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `Ronin Master Crew List/Roster` → `/wiki/Ronin_Master_Crew_List/Roster`. */
export function wikiPageUrl(title: string): string {
  const slug = encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')
  return `${WIKI_BASE}/wiki/${slug}`
}

export async function searchWiki(query: string, opts: SourceOpts = {}): Promise<SearchGroup> {
  const seeAllUrl = `${WIKI_BASE}/w/index.php?search=${encodeURIComponent(query)}`
  try {
    const url =
      `${WIKI_BASE}/w/api.php?action=query&list=search&format=json&origin=*` +
      `&srlimit=${HITS_PER_GROUP}&srsearch=${encodeURIComponent(query)}`
    const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, opts)
    if (!res.ok) return unavailable('wiki', seeAllUrl)
    const body = (await res.json()) as {
      query?: { search?: Array<{ title: string; snippet?: string }> }
    }
    const hits: SearchHit[] = (body.query?.search ?? []).slice(0, HITS_PER_GROUP).map((r) => ({
      source: 'wiki',
      title: r.title,
      snippet: r.snippet ? stripWikiSnippet(r.snippet) || null : null,
      url: wikiPageUrl(r.title),
    }))
    return { source: 'wiki', hits, seeAllUrl }
  } catch {
    return unavailable('wiki', seeAllUrl)
  }
}

/**
 * Both server routes speak the same envelope, so one reader covers them.
 * A group the server omits is "not applicable to this caller" and is dropped
 * rather than shown empty; `expected` is what we render as unavailable when
 * the whole request fails.
 */
async function readEnvelope(
  url: string,
  init: RequestInit,
  expected: SearchSource[],
  seeAll: (source: SearchSource) => string | null,
  opts: SourceOpts
): Promise<SearchGroup[]> {
  try {
    const res = await fetchWithTimeout(url, init, opts)
    if (!res.ok) return expected.map((s) => unavailable(s, seeAll(s)))
    const body = (await res.json()) as SearchResponse
    if (!Array.isArray(body?.groups)) return expected.map((s) => unavailable(s, seeAll(s)))
    return body.groups.map((g) => ({
      ...g,
      hits: (g.hits ?? []).slice(0, HITS_PER_GROUP),
      seeAllUrl: g.seeAllUrl ?? seeAll(g.source),
    }))
  } catch {
    return expected.map((s) => unavailable(s, seeAll(s)))
  }
}

export async function searchMainSite(query: string, opts: SourceOpts = {}): Promise<SearchGroup[]> {
  const q = encodeURIComponent(query)
  const seeAll = (source: SearchSource) =>
    source === 'sims' ? `${SITE_BASE}/sims/search/?q=${q}` : `${SITE_BASE}/search?q=${q}`
  return readEnvelope(
    `${SITE_BASE}/api/search?q=${q}`,
    { headers: { accept: 'application/json' } },
    ['news', 'pages', 'sims'],
    seeAll,
    opts
  )
}

/**
 * Staff-only, proxied through HQ so the gate is enforced server-side rather
 * than by this client. Skipping the request for a non-staff caller is an
 * optimization; the server returning `{ groups: [] }` is the guarantee.
 */
export async function searchForum(query: string, opts: SourceOpts = {}): Promise<SearchGroup[]> {
  const q = encodeURIComponent(query)
  const seeAll = () => `https://staff.starbase118.net/search?q=${q}`
  return readEnvelope(
    `${HQ_BASE}/api/search/forum?q=${q}`,
    { credentials: 'include', headers: { accept: 'application/json' } },
    ['forum'],
    seeAll,
    opts
  )
}

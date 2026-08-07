import type { NavEntry } from '@/lib/nav-cache'
import { destinationGroup } from '@/lib/destinations'
import { searchForum, searchMainSite, searchWiki, type FetchLike } from '@/lib/search-sources'
import { MIN_REMOTE_QUERY, type SearchGroup, type SearchSource } from '@/lib/search-types'

export interface SearchContext {
  signedIn: boolean
  isStaff: boolean
  nav: NavEntry[]
}

export interface RunSearchOpts {
  signal?: AbortSignal
  fetchFn?: FetchLike
  timeoutMs?: number
  /** Called once per group, the moment that source resolves. */
  onGroup: (group: SearchGroup) => void
}

/**
 * Which groups this query will produce, in advance — the popup uses it to put
 * a "searching…" row in place so a slow source is visibly pending rather than
 * looking like a source with no matches.
 */
export function pendingSources(query: string, ctx: SearchContext): SearchSource[] {
  const q = query.trim()
  if (!q) return []
  const sources: SearchSource[] = []
  if (ctx.nav.length) sources.push('destination')
  if (q.length >= MIN_REMOTE_QUERY) {
    sources.push('wiki', 'news', 'pages', 'sims')
    if (ctx.signedIn && ctx.isStaff) sources.push('forum')
  }
  return sources
}

/**
 * Federated search: one local match and up to three requests, each rendering
 * into its own group as it lands. There is no barrier — a slow forum query
 * never delays wiki results, and one failed source leaves the others intact.
 *
 * Cancellation is the caller's: hand in a fresh AbortController per keystroke.
 * Every emit is gated on that signal, so a response for an older query can
 * never overwrite newer results even if it resolves late.
 */
export async function runSearch(
  query: string,
  ctx: SearchContext,
  opts: RunSearchOpts
): Promise<void> {
  const q = query.trim()
  if (!q) return

  const { signal, fetchFn, timeoutMs, onGroup } = opts
  const emit = (group: SearchGroup) => {
    if (signal?.aborted) return
    onGroup(group)
  }
  const emitAll = (groups: SearchGroup[]) => groups.forEach(emit)

  // Destinations are local: they must be on screen before any request is made.
  if (ctx.nav.length) emit(destinationGroup(ctx.nav, q))

  // A single keystroke never triggers three requests.
  if (q.length < MIN_REMOTE_QUERY) return

  const sourceOpts = { signal, fetchFn, timeoutMs }
  const tasks: Promise<void>[] = [
    searchWiki(q, sourceOpts).then(emit),
    searchMainSite(q, sourceOpts).then(emitAll),
  ]
  if (ctx.signedIn && ctx.isStaff) tasks.push(searchForum(q, sourceOpts).then(emitAll))

  await Promise.all(tasks)
}

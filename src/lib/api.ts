import type { NavEntry } from '@/lib/nav-cache'

export interface ApiMeResponse {
  authenticated: true
  writer_id: string | null
  displayName: string | null
  isStaff: boolean
  staffRoles: string[]
  /**
   * The HQ pages this caller may open, filtered server-side by their groups
   * (megatool PR #751). Optional so the extension still runs against a
   * megatool deployed before that route change.
   */
  nav?: NavEntry[]
  ship: { name: string | null; wikiUrl: string | null }
  character: { name: string | null; wikiUrl: string | null }
}

export interface ApiMeUnauthenticated { authenticated: false }

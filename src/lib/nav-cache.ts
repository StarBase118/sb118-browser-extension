import browser from 'webextension-polyfill'
import { readStorage } from '@/lib/storage'

/** One HQ page the caller is permitted to open, as returned by `/api/me`. */
export interface NavEntry {
  label: string
  path: string
  category: string
}

const KEY = 'navCache'

function isNavList(v: unknown): v is NavEntry[] {
  return (
    Array.isArray(v) &&
    v.every(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as NavEntry).label === 'string' &&
        typeof (e as NavEntry).path === 'string'
    )
  )
}

export async function getNav(): Promise<NavEntry[]> {
  return readStorage(KEY, isNavList, [])
}

/**
 * Replace the cache wholesale — never merge. Group membership can change
 * between sessions, so a merge would keep handing back pages the caller has
 * since lost access to.
 */
export async function setNav(nav: NavEntry[]): Promise<void> {
  await browser.storage.local.set({ [KEY]: nav })
}

/**
 * Clear whenever `/api/me` does not return an authenticated profile — a 401,
 * a network failure, or an explicit sign-out.
 *
 * The cache outlives the popup, so without this a signed-out user would keep
 * seeing and matching against the previous session's page list.
 */
export async function clearNav(): Promise<void> {
  await browser.storage.local.remove(KEY)
}

/**
 * Reconcile the cache with what `/api/me` just said, and return the list that
 * is now in effect.
 *
 * A stale-but-authenticated entry is harmless — the link either still resolves
 * or lands on HQ's own not-authorized page. A stale *signed-out* entry is not,
 * which is why anything short of an authenticated profile clears it.
 */
export async function syncNavCache(profile: { nav?: NavEntry[] } | null): Promise<NavEntry[]> {
  if (!profile) {
    await clearNav()
    return []
  }
  const nav = isNavList(profile.nav) ? profile.nav : []
  await setNav(nav)
  return nav
}

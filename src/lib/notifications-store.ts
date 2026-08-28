import browser from 'webextension-polyfill'
import { readStorage } from '@/lib/storage'
import {
  ALL_SOURCES,
  type LastSeen,
  type NotificationSource,
  type NotificationsResponse,
} from '@/lib/notifications-types'

const LAST_SEEN_KEY = 'notifLastSeen'
const COUNT_KEY = 'notifCount'
const ITEMS_KEY = 'notifItems'
const CLICKED_KEY = 'notifClicked'

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isLastSeen(v: unknown): v is LastSeen {
  return (
    isPlainRecord(v) &&
    Object.entries(v).every(
      ([source, marker]) => ALL_SOURCES.includes(source as LastSeenKey) && typeof marker === 'string'
    )
  )
}

type LastSeenKey = (typeof ALL_SOURCES)[number]

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export async function getLastSeen(): Promise<LastSeen> {
  return readStorage(LAST_SEEN_KEY, isLastSeen, {})
}

export async function setLastSeen(next: LastSeen): Promise<void> {
  await browser.storage.local.set({ [LAST_SEEN_KEY]: next })
}

export async function getCachedCount(): Promise<number> {
  return readStorage(COUNT_KEY, isCount, 0)
}

export async function setCachedCount(total: number): Promise<void> {
  await browser.storage.local.set({ [COUNT_KEY]: total })
}

function isItemShape(v: unknown): boolean {
  return (
    isPlainRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.url === 'string' &&
    typeof v.at === 'string'
  )
}

function isSourcesShape(v: unknown): v is NotificationsResponse['sources'] {
  if (!isPlainRecord(v)) return false
  return Object.entries(v).every(([source, group]) => {
    if (!ALL_SOURCES.includes(source as NotificationSource)) return false
    if (!isPlainRecord(group)) return false
    if (!Array.isArray(group.items) || !group.items.every(isItemShape)) return false
    return group.unavailable === undefined || typeof group.unavailable === 'boolean'
  })
}

/**
 * The payload the worker last fetched, or null.
 *
 * Null means "we have not successfully looked" — absent, unparseable, or the
 * wrong shape. That is deliberately NOT the same as an empty payload, which
 * means "we looked and it was quiet": the popup says "checking" for the first
 * and "nothing new" for the second, and telling a member nothing is new on the
 * strength of a cache we could not read would be a claim we have not earned.
 */
export async function getCachedItems(): Promise<NotificationsResponse['sources'] | null> {
  const r = await browser.storage.local.get(ITEMS_KEY)
  const v = (r as Record<string, unknown>)[ITEMS_KEY]
  return isSourcesShape(v) ? v : null
}

export async function setCachedItems(sources: NotificationsResponse['sources']): Promise<void> {
  await browser.storage.local.set({ [ITEMS_KEY]: sources })
}

/**
 * `${source}:${id}` — never the bare id.
 *
 * NotificationItem.id is only unique WITHIN a source, so a sim and a Community
 * News item can both legitimately be "1234". Keying on the bare id would hide
 * an unrelated row in another source, rarely enough to look like a ghost.
 */
export function clickedKey(source: NotificationSource, id: string): string {
  return `${source}:${id}`
}

function isClickedList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((k) => typeof k === 'string')
}

export async function getClicked(): Promise<string[]> {
  return readStorage(CLICKED_KEY, isClickedList, [])
}

export async function addClicked(key: string): Promise<void> {
  const current = await getClicked()
  if (current.includes(key)) return
  await browser.storage.local.set({ [CLICKED_KEY]: [...current, key] })
}

/**
 * Drop stored keys whose item is no longer in the payload.
 *
 * ONLY keys belonging to a healthy source are eligible. A source that is
 * absent from the payload, or flagged `unavailable`, keeps every key it has —
 * otherwise one Discord outage un-dismisses every announcement the member has
 * already read, and they all reappear when the source recovers.
 */
export async function pruneClicked(sources: NotificationsResponse['sources']): Promise<void> {
  const current = await getClicked()
  if (!current.length) return

  const healthy = new Set<string>()
  const live = new Set<string>()
  for (const source of ALL_SOURCES) {
    const group = sources[source]
    if (!group || group.unavailable) continue
    healthy.add(source)
    for (const item of group.items) live.add(clickedKey(source, item.id))
  }

  // A key under a sick or missing source is not evidence of anything, so it
  // survives untouched.
  const next = current.filter((key) => {
    const source = key.slice(0, key.indexOf(':'))
    return !healthy.has(source) || live.has(key)
  })

  if (next.length === current.length) return
  await browser.storage.local.set({ [CLICKED_KEY]: next })
}

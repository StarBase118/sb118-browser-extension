import { isItemNew } from '@/lib/notification-count'
import type {
  LastSeen,
  NotificationSource,
  NotificationsResponse,
} from '@/lib/notifications-types'

export type NotificationListState =
  | 'ok' // render the items, which may legitimately be none
  | 'outage' // every enabled source failed
  | 'disabled' // the member switched every source off

export interface DisplayItem {
  id: string
  title: string
  url: string
  at: string
  source: NotificationSource
  isNew: boolean
}

export interface NotificationListResult {
  items: DisplayItem[]
  state: NotificationListState
}

/** Old items shown alongside the new ones. New items are never capped away. */
export const LIST_CAP = 8

function timeOf(iso: string): number {
  const ms = Date.parse(iso)
  // An item whose timestamp will not parse is still a real thing that
  // happened, so it sorts last rather than being dropped.
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

function newestFirst(a: DisplayItem, b: DisplayItem): number {
  return timeOf(b.at) - timeOf(a.at)
}

/**
 * Turn the cached payload into the ordered list the popup renders.
 *
 * The truncation is a PARTITION, not a sort-then-slice, and that is the whole
 * reason this function exists separately from the render. Markers are per
 * source, so "new" is not a function of absolute time across the merged list:
 * if the sims marker is an hour old and the news marker is three days old, a
 * read sim from five hours ago sorts above an unread news item from two days
 * ago. Slicing a time-sorted list at the cap would therefore drop unread items
 * to make room for read ones — the exact failure this phase exists to prevent.
 */
export function buildNotificationList(
  sources: NotificationsResponse['sources'],
  lastSeen: LastSeen,
  enabled: NotificationSource[],
  cap: number = LIST_CAP
): NotificationListResult {
  // Checked before anything else: an emptiness test written first would report
  // an outage to a member who simply switched every source off.
  if (!enabled.length) return { items: [], state: 'disabled' }

  const fresh: DisplayItem[] = []
  const seen: DisplayItem[] = []
  let anyAvailable = false

  for (const source of enabled) {
    const group = sources[source]
    if (!group || group.unavailable) continue
    anyAvailable = true

    for (const item of group.items) {
      const display: DisplayItem = { ...item, source, isNew: isItemNew(item, lastSeen[source]) }
      ;(display.isNew ? fresh : seen).push(display)
    }
  }

  if (!anyAvailable) return { items: [], state: 'outage' }

  fresh.sort(newestFirst)
  seen.sort(newestFirst)

  return {
    items: [...fresh, ...seen.slice(0, Math.max(0, cap - fresh.length))],
    state: 'ok',
  }
}

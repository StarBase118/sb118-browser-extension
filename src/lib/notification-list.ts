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
  clicked: ReadonlySet<string> = new Set(),
  cap: number = LIST_CAP
): NotificationListResult {
  // Checked before anything else: an emptiness test written first would report
  // an outage to a member who simply switched every source off.
  if (!enabled.length) return { items: [], state: 'disabled' }

  const fresh: DisplayItem[] = []
  const seen: DisplayItem[] = []
  let sawAvailable = false
  let sawUnavailable = false

  for (const source of enabled) {
    const group = sources[source]
    // A source that is simply ABSENT from the payload is not the same as one
    // HQ flagged unavailable, and conflating them reports an outage for a
    // perfectly healthy quiet payload — `{}` renders "couldn't reach HQ".
    // Only an explicit unavailable flag is evidence that something failed.
    if (!group) continue
    if (group.unavailable) {
      sawUnavailable = true
      continue
    }
    sawAvailable = true

    for (const item of group.items) {
      // Filtered BEFORE the partition, not after: dropping a seen item here
      // frees a slot that seen.slice() then fills from the next item down.
      // Filtering the finished list instead would leave a hole.
      if (clicked.has(`${source}:${item.id}`)) continue
      const display: DisplayItem = { ...item, source, isNew: isItemNew(item, lastSeen[source]) }
      ;(display.isNew ? fresh : seen).push(display)
    }
  }

  if (!sawAvailable && sawUnavailable) return { items: [], state: 'outage' }

  fresh.sort(newestFirst)
  seen.sort(newestFirst)

  return {
    items: [...fresh, ...seen.slice(0, Math.max(0, cap - fresh.length))],
    state: 'ok',
  }
}

export type PopupTab = 'launcher' | 'notifs'

/**
 * Which tab the popup opens on.
 *
 * Reads the cached badge count rather than the built list, deliberately: it is
 * the number the toolbar icon is showing, so the tab and the icon tell one
 * story. `enabledCount` of zero means every source is switched off, in which
 * case there is no tab strip and the launcher is the whole popup.
 */
export function selectDefaultTab(newCount: number, enabledCount: number): PopupTab {
  if (enabledCount === 0) return 'launcher'
  return newCount > 0 ? 'notifs' : 'launcher'
}

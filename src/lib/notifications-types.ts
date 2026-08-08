/**
 * Shared notification shapes and tuning constants. The background worker,
 * storage, and popup message flow all agree on these without introducing I/O
 * into the type module.
 */

export type NotificationSource = 'announcements' | 'sims' | 'news'

export interface NotificationItem {
  id: string
  title: string
  url: string
  at: string
}

export interface NotificationGroup {
  items: NotificationItem[]
  unavailable?: boolean
}

export interface NotificationsResponse {
  sources: Partial<Record<NotificationSource, NotificationGroup>>
}

export type LastSeen = Partial<Record<NotificationSource, string>>

export const ALL_SOURCES: NotificationSource[] = ['announcements', 'sims', 'news']
export const BADGE_CAP = 9
export const POLL_PERIOD_MINUTES = 15
export const FETCH_TIMEOUT_MS = 8000

export const SOURCE_LABELS: Record<NotificationSource, string> = {
  announcements: 'Announcements',
  sims: 'Sims',
  news: 'News',
}

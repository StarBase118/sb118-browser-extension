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

/**
 * Shape guards for the payload, shared by the client (validating what HQ sent)
 * and the store (validating what came back out of storage.local). They live
 * here rather than in either consumer because both check the SAME types
 * declared above: two copies drift the moment a field is added, and storage
 * validation quietly falling behind wire validation is hard to notice.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isNotificationItem(v: unknown): v is NotificationItem {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.url === 'string' &&
    typeof v.at === 'string'
  )
}

export function isNotificationGroup(v: unknown): v is NotificationGroup {
  return (
    isRecord(v) &&
    Array.isArray(v.items) &&
    v.items.every(isNotificationItem) &&
    (v.unavailable === undefined || typeof v.unavailable === 'boolean')
  )
}

/** Every key names a known source and every value is a valid group. */
export function isSources(v: unknown): v is NotificationsResponse['sources'] {
  if (!isRecord(v)) return false
  return Object.entries(v).every(
    ([source, group]) =>
      ALL_SOURCES.includes(source as NotificationSource) && isNotificationGroup(group)
  )
}

export const SOURCE_LABELS: Record<NotificationSource, string> = {
  announcements: 'Announcements',
  sims: 'Sims',
  news: 'News',
}

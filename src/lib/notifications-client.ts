import {
  ALL_SOURCES,
  FETCH_TIMEOUT_MS,
  type NotificationGroup,
  type NotificationItem,
  type NotificationSource,
  type NotificationsResponse,
} from '@/lib/notifications-types'

const ENDPOINT = 'https://hq.starbase118.net/api/me/notifications?limit=20'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNotificationItem(v: unknown): v is NotificationItem {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.url === 'string' &&
    typeof v.at === 'string'
  )
}

function isNotificationGroup(v: unknown): v is NotificationGroup {
  return (
    isRecord(v) &&
    Array.isArray(v.items) &&
    v.items.every(isNotificationItem) &&
    (v.unavailable === undefined || typeof v.unavailable === 'boolean')
  )
}

function normalizeSources(v: Record<string, unknown>): NotificationsResponse['sources'] {
  const sources: NotificationsResponse['sources'] = {}
  for (const source of ALL_SOURCES) {
    const group = v[source]
    if (isNotificationGroup(group)) sources[source] = group
  }
  return sources
}

export async function fetchNotifications(sources?: NotificationSource[]): Promise<NotificationsResponse | null> {
  // An explicit empty list means the member disabled every source. Do not send
  // `sources=` because the server treats an absent/empty filter as "all".
  if (sources?.length === 0) return { sources: {} }

  const url = sources ? `${ENDPOINT}&sources=${sources.join(',')}` : ENDPOINT

  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (res.status === 401) return { sources: {} }
    if (res.status !== 200) return null

    const body = (await res.json()) as unknown
    if (!isRecord(body) || !isRecord(body.sources)) return null

    return { sources: normalizeSources(body.sources) }
  } catch {
    return null
  }
}

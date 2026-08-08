import {
  BADGE_CAP,
  type LastSeen,
  type NotificationGroup,
  type NotificationSource,
  type NotificationsResponse,
} from '@/lib/notifications-types'

function parseIso(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

export function countNewForSource(
  group: NotificationGroup | undefined,
  lastSeenIso: string | undefined
): number {
  if (!group || group.unavailable || !group.items.length) return 0

  // A missing marker means this browser has never cleared the source. Count
  // what HQ returned so a fresh install shows recent activity instead of a
  // misleading zero.
  if (!lastSeenIso) return group.items.length

  // A stored marker that will not parse is corrupt, not a real "seen" point.
  // Returning 0 here would silently pin the source at zero until something
  // else happened to rewrite the marker — the badge would look calm while
  // activity piled up. Fall back to the same handling as a missing marker.
  const lastSeenMs = parseIso(lastSeenIso)
  if (lastSeenMs === null) return group.items.length

  return group.items.filter((item) => {
    const itemMs = parseIso(item.at)
    return itemMs !== null && itemMs > lastSeenMs
  }).length
}

export function countNew(
  sources: NotificationsResponse['sources'],
  lastSeen: LastSeen,
  enabled: NotificationSource[]
): number {
  return enabled.reduce((total, source) => total + countNewForSource(sources[source], lastSeen[source]), 0)
}

export function badgeText(total: number): string {
  if (total <= 0) return ''
  if (total > BADGE_CAP) return `${BADGE_CAP}+`
  return String(total)
}

export function advanceLastSeen(
  current: LastSeen,
  sources: NotificationsResponse['sources'],
  seenSources: NotificationSource[]
): LastSeen {
  const next: LastSeen = { ...current }

  for (const source of seenSources) {
    const group = sources[source]
    if (!group || group.unavailable || !group.items.length) continue

    let newest: { iso: string; ms: number } | null = null
    for (const item of group.items) {
      const ms = parseIso(item.at)
      if (ms === null) continue
      if (!newest || ms > newest.ms) newest = { iso: item.at, ms }
    }
    if (!newest) continue

    const stored = next[source]
    const storedMs = stored ? parseIso(stored) : null
    if (storedMs !== null && storedMs >= newest.ms) continue

    next[source] = newest.iso
  }

  return next
}

import { describe, it, expect } from 'vitest'
import {
  advanceLastSeen,
  badgeText,
  countNew,
  countNewForSource,
  isItemNew,
} from '@/lib/notification-count'
import type { LastSeen, NotificationGroup, NotificationsResponse } from '@/lib/notifications-types'

const notificationItem = (id: string, at: string) => ({
  id,
  title: id,
  url: `https://hq.starbase118.net/${id}`,
  at,
})

describe('countNewForSource', () => {
  it('returns zero for an absent group', () => {
    expect(countNewForSource(undefined, '2026-08-07T16:00:00.000Z')).toBe(0)
  })

  it('returns zero for an unavailable group', () => {
    expect(countNewForSource({ items: [notificationItem('a', '2026-08-07T17:00:00.000Z')], unavailable: true }, undefined)).toBe(0)
  })

  it('returns zero for an empty group', () => {
    expect(countNewForSource({ items: [] }, undefined)).toBe(0)
  })

  it('counts every returned item when no marker exists because the source has never been cleared', () => {
    expect(countNewForSource({
      items: [
        notificationItem('a', '2026-08-07T17:00:00.000Z'),
        notificationItem('b', '2026-08-07T16:00:00.000Z'),
      ],
    }, undefined)).toBe(2)
  })

  it('does not count an item whose timestamp equals the marker', () => {
    expect(countNewForSource({
      items: [
        notificationItem('newer', '2026-08-07T17:00:00.000Z'),
        notificationItem('equal', '2026-08-07T16:00:00.000Z'),
      ],
    }, '2026-08-07T16:00:00.000Z')).toBe(1)
  })

  it('does not count an item with an unparseable timestamp', () => {
    expect(countNewForSource({
      items: [
        notificationItem('bad', 'not-a-date'),
        notificationItem('good', '2026-08-07T17:00:00.000Z'),
      ],
    }, '2026-08-07T16:00:00.000Z')).toBe(1)
  })

  it('treats a corrupt stored marker like a missing one rather than pinning the source at zero', () => {
    expect(countNewForSource({
      items: [
        notificationItem('a', '2026-08-07T17:00:00.000Z'),
        notificationItem('b', '2026-08-07T18:00:00.000Z'),
      ],
    }, 'not-a-date')).toBe(2)
  })

  it('parses offsets instead of string-comparing timestamps', () => {
    expect(countNewForSource({
      items: [
        notificationItem('same', '2026-08-07T12:00:00+00:00'),
        notificationItem('newer', '2026-08-07T12:00:01Z'),
      ],
    }, '2026-08-07T12:00:00.000Z')).toBe(1)
  })
})

describe('countNew', () => {
  const sources: NotificationsResponse['sources'] = {
    announcements: { items: [notificationItem('a', '2026-08-07T17:00:00.000Z')] },
    sims: { items: [notificationItem('s', '2026-08-07T18:00:00.000Z')] },
    news: { items: [notificationItem('n', '2026-08-07T19:00:00.000Z')] },
  }

  it('sums across sources', () => {
    expect(countNew(sources, {}, ['announcements', 'sims', 'news'])).toBe(3)
  })

  it('excludes a source that is not enabled', () => {
    expect(countNew(sources, {}, ['announcements', 'news'])).toBe(2)
  })
})

describe('badgeText', () => {
  it('clears zero', () => {
    expect(badgeText(0)).toBe('')
  })

  it('shows totals through the cap', () => {
    expect(badgeText(1)).toBe('1')
    expect(badgeText(9)).toBe('9')
  })

  it('caps totals above the cap', () => {
    expect(badgeText(10)).toBe('9+')
    expect(badgeText(500)).toBe('9+')
  })
})

describe('advanceLastSeen', () => {
  it('advances to the newest item instead of assuming items[0]', () => {
    const next = advanceLastSeen({}, {
      announcements: {
        items: [
          notificationItem('older-first', '2026-08-07T16:00:00.000Z'),
          notificationItem('newest-second', '2026-08-07T18:00:00.000Z'),
          notificationItem('middle', '2026-08-07T17:00:00.000Z'),
        ],
      },
    }, ['announcements'])

    expect(next.announcements).toBe('2026-08-07T18:00:00.000Z')
  })

  it('never moves a marker backwards', () => {
    const current: LastSeen = { sims: '2026-08-08T00:00:00.000Z' }
    const next = advanceLastSeen(current, {
      sims: { items: [notificationItem('older', '2026-08-07T18:00:00.000Z')] },
    }, ['sims'])

    expect(next.sims).toBe('2026-08-08T00:00:00.000Z')
  })

  it('leaves absent, empty, and unavailable sources untouched', () => {
    const current: LastSeen = {
      announcements: '2026-08-07T10:00:00.000Z',
      sims: '2026-08-07T11:00:00.000Z',
      news: '2026-08-07T12:00:00.000Z',
    }
    const sources: Record<'sims' | 'news', NotificationGroup> = {
      sims: { items: [] },
      news: { items: [notificationItem('n', '2026-08-07T13:00:00.000Z')], unavailable: true },
    }

    expect(advanceLastSeen(current, sources, ['announcements', 'sims', 'news'])).toEqual(current)
  })

  it('does not mutate the input object', () => {
    const current: LastSeen = { announcements: '2026-08-07T10:00:00.000Z' }
    const next = advanceLastSeen(current, {
      announcements: { items: [notificationItem('newer', '2026-08-07T11:00:00.000Z')] },
    }, ['announcements'])

    expect(next).not.toBe(current)
    expect(current).toEqual({ announcements: '2026-08-07T10:00:00.000Z' })
    expect(next.announcements).toBe('2026-08-07T11:00:00.000Z')
  })
})

const item = (at: string) => ({ id: 'i', title: 't', url: 'https://x/', at })

describe('isItemNew', () => {
  it('is true when the marker is missing', () => {
    expect(isItemNew(item('2026-08-13T10:00:00Z'), undefined)).toBe(true)
  })
  it('is true when the marker will not parse', () => {
    expect(isItemNew(item('2026-08-13T10:00:00Z'), 'not-a-date')).toBe(true)
  })
  it('is false for an item exactly at the marker', () => {
    expect(isItemNew(item('2026-08-13T10:00:00Z'), '2026-08-13T10:00:00Z')).toBe(false)
  })
  it('is true one millisecond after the marker', () => {
    expect(isItemNew(item('2026-08-13T10:00:00.001Z'), '2026-08-13T10:00:00Z')).toBe(true)
  })
  it('is false when the item timestamp will not parse', () => {
    expect(isItemNew(item('garbage'), '2026-08-13T10:00:00Z')).toBe(false)
  })
})

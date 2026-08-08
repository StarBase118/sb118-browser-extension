import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LastSeen, NotificationsResponse } from '@/lib/notifications-types'

const mocks = vi.hoisted(() => ({
  alarmCreate: vi.fn(),
  alarmListeners: [] as Array<(alarm: { name: string }) => void>,
  installedListeners: [] as Array<() => void>,
  startupListeners: [] as Array<() => void>,
  messageListeners: [] as Array<(message: unknown) => unknown>,
  alarmAddListener: vi.fn((cb: (alarm: { name: string }) => void) => { mocks.alarmListeners.push(cb) }),
  installedAddListener: vi.fn((cb: () => void) => { mocks.installedListeners.push(cb) }),
  startupAddListener: vi.fn((cb: () => void) => { mocks.startupListeners.push(cb) }),
  messageAddListener: vi.fn((cb: (message: unknown) => unknown) => { mocks.messageListeners.push(cb) }),
  setBadgeText: vi.fn(),
  setBadgeBackgroundColor: vi.fn(),
  fetchNotifications: vi.fn(),
  getLastSeen: vi.fn(),
  setLastSeen: vi.fn(),
  setCachedCount: vi.fn(),
  getPrefs: vi.fn(),
}))

vi.mock('webextension-polyfill', () => ({
  default: {
    action: {
      setBadgeText: mocks.setBadgeText,
      setBadgeBackgroundColor: mocks.setBadgeBackgroundColor,
    },
    alarms: {
      create: mocks.alarmCreate,
      onAlarm: { addListener: mocks.alarmAddListener },
    },
    runtime: {
      onInstalled: { addListener: mocks.installedAddListener },
      onStartup: { addListener: mocks.startupAddListener },
      onMessage: { addListener: mocks.messageAddListener },
    },
  },
}))

vi.mock('@/lib/notifications-client', () => ({
  fetchNotifications: mocks.fetchNotifications,
}))

vi.mock('@/lib/notifications-store', () => ({
  getLastSeen: mocks.getLastSeen,
  setLastSeen: mocks.setLastSeen,
  setCachedCount: mocks.setCachedCount,
}))

vi.mock('@/lib/prefs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/prefs')>('@/lib/prefs')
  return {
    ...actual,
    getPrefs: mocks.getPrefs,
  }
})

import { markAllSeen, refreshBadge } from '@/background'

const response = (sources: NotificationsResponse['sources']): NotificationsResponse => ({ sources })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPrefs.mockResolvedValue({})
  mocks.getLastSeen.mockResolvedValue({})
  mocks.setLastSeen.mockResolvedValue(undefined)
  mocks.setCachedCount.mockResolvedValue(undefined)
  mocks.setBadgeText.mockResolvedValue(undefined)
  mocks.setBadgeBackgroundColor.mockResolvedValue(undefined)
})

describe('background notification badge', () => {
  it('registers alarm, startup, install, and message listeners', () => {
    expect(mocks.installedListeners).toHaveLength(1)
    expect(mocks.startupListeners).toHaveLength(1)
    expect(mocks.alarmListeners).toHaveLength(1)
    expect(mocks.messageListeners).toHaveLength(1)
  })

  it('leaves the badge untouched when a poll cannot look', async () => {
    mocks.fetchNotifications.mockResolvedValue(null)

    await refreshBadge()

    expect(mocks.setCachedCount).not.toHaveBeenCalled()
    expect(mocks.setBadgeText).not.toHaveBeenCalled()
    expect(mocks.setBadgeBackgroundColor).not.toHaveBeenCalled()
  })

  it('counts new notifications and renders the toolbar badge', async () => {
    mocks.fetchNotifications.mockResolvedValue(response({
      announcements: {
        items: [
          { id: 'a', title: 'A', url: 'https://hq.starbase118.net/a', at: '2026-08-07T17:00:00.000Z' },
        ],
      },
      sims: {
        items: [
          { id: 's1', title: 'S1', url: 'https://hq.starbase118.net/s1', at: '2026-08-07T18:00:00.000Z' },
          { id: 's2', title: 'S2', url: 'https://hq.starbase118.net/s2', at: '2026-08-07T19:00:00.000Z' },
        ],
      },
    }))
    mocks.getLastSeen.mockResolvedValue({ announcements: '2026-08-07T16:00:00.000Z' })

    await refreshBadge()

    expect(mocks.setCachedCount).toHaveBeenCalledWith(3)
    expect(mocks.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#0d1120' })
    expect(mocks.setBadgeText).toHaveBeenCalledWith({ text: '3' })
  })

  it('excludes a disabled source from the request and badge total', async () => {
    mocks.getPrefs.mockResolvedValue({ notifications: { news: false } })
    mocks.fetchNotifications.mockResolvedValue(response({
      announcements: {
        items: [
          { id: 'a', title: 'A', url: 'https://hq.starbase118.net/a', at: '2026-08-07T17:00:00.000Z' },
        ],
      },
      sims: {
        items: [
          { id: 's', title: 'S', url: 'https://hq.starbase118.net/s', at: '2026-08-07T18:00:00.000Z' },
        ],
      },
      news: {
        items: [
          { id: 'n', title: 'N', url: 'https://hq.starbase118.net/n', at: '2026-08-07T19:00:00.000Z' },
        ],
      },
    }))

    await refreshBadge()

    expect(mocks.fetchNotifications).toHaveBeenCalledWith(['announcements', 'sims'])
    expect(mocks.setCachedCount).toHaveBeenCalledWith(2)
    expect(mocks.setBadgeText).toHaveBeenCalledWith({ text: '2' })
  })

  it('marks all visible sources seen and clears the badge', async () => {
    const current: LastSeen = { announcements: '2026-08-07T10:00:00.000Z' }
    mocks.fetchNotifications.mockResolvedValue(response({
      announcements: {
        items: [
          { id: 'a', title: 'A', url: 'https://hq.starbase118.net/a', at: '2026-08-07T17:00:00.000Z' },
        ],
      },
    }))
    mocks.getLastSeen.mockResolvedValue(current)

    await markAllSeen()

    expect(mocks.setLastSeen).toHaveBeenCalledWith({ announcements: '2026-08-07T17:00:00.000Z' })
    expect(mocks.setCachedCount).toHaveBeenCalledWith(0)
    expect(mocks.setBadgeText).toHaveBeenCalledWith({ text: '' })
  })

  it('does not advance a disabled source marker when marking seen', async () => {
    const current: LastSeen = {
      announcements: '2026-08-07T10:00:00.000Z',
      news: '2026-08-07T11:00:00.000Z',
    }
    mocks.getPrefs.mockResolvedValue({ notifications: { news: false } })
    mocks.fetchNotifications.mockResolvedValue(response({
      announcements: {
        items: [
          { id: 'a', title: 'A', url: 'https://hq.starbase118.net/a', at: '2026-08-07T17:00:00.000Z' },
        ],
      },
      news: {
        items: [
          { id: 'n', title: 'N', url: 'https://hq.starbase118.net/n', at: '2026-08-07T18:00:00.000Z' },
        ],
      },
    }))
    mocks.getLastSeen.mockResolvedValue(current)

    await markAllSeen()

    expect(mocks.fetchNotifications).toHaveBeenCalledWith(['announcements', 'sims'])
    expect(mocks.setLastSeen).toHaveBeenCalledWith({
      announcements: '2026-08-07T17:00:00.000Z',
      news: '2026-08-07T11:00:00.000Z',
    })
  })

  it('does not clear seen state when markAllSeen cannot look', async () => {
    mocks.fetchNotifications.mockResolvedValue(null)

    await markAllSeen()

    expect(mocks.setLastSeen).not.toHaveBeenCalled()
    expect(mocks.setCachedCount).not.toHaveBeenCalled()
    expect(mocks.setBadgeText).not.toHaveBeenCalled()
  })
})

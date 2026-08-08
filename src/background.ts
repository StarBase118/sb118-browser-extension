/**
 * MV3 service workers are terminated aggressively, so module-level state is
 * not durable. Every badge marker and cached count is read from storage.local.
 */
import browser, { type Runtime } from 'webextension-polyfill'
import { badgeText, advanceLastSeen, countNew } from '@/lib/notification-count'
import { fetchNotifications } from '@/lib/notifications-client'
import { ALL_SOURCES, POLL_PERIOD_MINUTES } from '@/lib/notifications-types'
import { getLastSeen, setLastSeen, setCachedCount } from '@/lib/notifications-store'

const ALARM_NAME = 'notif-poll'
const BADGE_BACKGROUND = '#0d1120'

function createPollAlarm(): void {
  browser.alarms.create(ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES })
}

async function setBadge(total: number): Promise<void> {
  await browser.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND })
  await browser.action.setBadgeText({ text: badgeText(total) })
}

export async function refreshBadge(): Promise<void> {
  const res = await fetchNotifications()

  // `null` means the worker could not look at all. Leave the existing badge
  // alone so a temporary HQ/network failure does not falsely clear activity.
  if (!res) return

  const total = countNew(res.sources, await getLastSeen(), ALL_SOURCES)
  await setCachedCount(total)
  await setBadge(total)
}

export async function markAllSeen(): Promise<void> {
  const res = await fetchNotifications()
  if (!res) return

  const next = advanceLastSeen(await getLastSeen(), res.sources, ALL_SOURCES)
  await setLastSeen(next)
  await setCachedCount(0)
  await setBadge(0)
}

browser.runtime.onInstalled.addListener(() => {
  console.debug('[sb118] extension installed')
  createPollAlarm()
  void refreshBadge()
})

browser.runtime.onStartup.addListener(() => {
  void refreshBadge()
})

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshBadge()
})

browser.runtime.onMessage.addListener((message: unknown, _sender: Runtime.MessageSender) => {
  if (typeof message !== 'object' || message === null || !('type' in message)) return undefined
  if (message.type === 'notif:seen') return markAllSeen()
  if (message.type === 'notif:refresh') return refreshBadge()
  return undefined
})

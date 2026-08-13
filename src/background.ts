/**
 * MV3 service workers are terminated aggressively, so module-level state is
 * not durable. Every badge marker and cached count is read from storage.local.
 */
import browser, { type Runtime } from 'webextension-polyfill'
import { badgeText, countNew } from '@/lib/notification-count'
import { fetchNotifications } from '@/lib/notifications-client'
import { POLL_PERIOD_MINUTES } from '@/lib/notifications-types'
import { getLastSeen, setCachedCount, setCachedItems } from '@/lib/notifications-store'
import { enabledSources, getPrefs } from '@/lib/prefs'

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
  const enabled = enabledSources(await getPrefs())
  const res = await fetchNotifications(enabled)

  // `null` means the worker could not look at all. Leave the existing badge AND
  // the existing cache alone, so a transient HQ failure neither falsely clears
  // activity nor blanks a list the member could still usefully read.
  if (!res) return

  await setCachedItems(res.sources)
  const total = countNew(res.sources, await getLastSeen(), enabled)
  await setCachedCount(total)
  await setBadge(total)
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
  if (message.type === 'notif:refresh') return refreshBadge()
  return undefined
})

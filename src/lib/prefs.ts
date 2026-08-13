import browser from 'webextension-polyfill'
import { readStorage } from '@/lib/storage'
import { ALL_SOURCES, type NotificationSource } from '@/lib/notifications-types'

export interface Prefs {
  manualShipUrl?: string
  manualCharacterUrl?: string
  notifications?: Partial<Record<NotificationSource, boolean>>
}

const KEY = 'prefs'

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function enabledSources(p: Prefs): NotificationSource[] {
  const stored = isPlainRecord(p.notifications) ? p.notifications : {}

  // Notification sources default on so old installs and partially written
  // prefs continue polling unless a member explicitly switches a source off.
  return ALL_SOURCES.filter((source) => stored[source] !== false)
}

export async function getPrefs(): Promise<Prefs> {
  return readStorage<Prefs>(KEY, (v): v is Prefs => isPlainRecord(v), {})
}

export async function setPrefs(p: Prefs): Promise<void> {
  const cur = await getPrefs()
  await browser.storage.local.set({ [KEY]: { ...cur, ...p } })
}

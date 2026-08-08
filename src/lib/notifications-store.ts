import browser from 'webextension-polyfill'
import { readStorage } from '@/lib/storage'
import { ALL_SOURCES, type LastSeen } from '@/lib/notifications-types'

const LAST_SEEN_KEY = 'notifLastSeen'
const COUNT_KEY = 'notifCount'

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isLastSeen(v: unknown): v is LastSeen {
  return (
    isPlainRecord(v) &&
    Object.entries(v).every(
      ([source, marker]) => ALL_SOURCES.includes(source as LastSeenKey) && typeof marker === 'string'
    )
  )
}

type LastSeenKey = (typeof ALL_SOURCES)[number]

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export async function getLastSeen(): Promise<LastSeen> {
  return readStorage(LAST_SEEN_KEY, isLastSeen, {})
}

export async function setLastSeen(next: LastSeen): Promise<void> {
  await browser.storage.local.set({ [LAST_SEEN_KEY]: next })
}

export async function getCachedCount(): Promise<number> {
  return readStorage(COUNT_KEY, isCount, 0)
}

export async function setCachedCount(total: number): Promise<void> {
  await browser.storage.local.set({ [COUNT_KEY]: total })
}

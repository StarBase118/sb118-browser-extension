import browser from 'webextension-polyfill'
import { readStorage } from '@/lib/storage'
export interface Prefs { manualShipUrl?: string; manualCharacterUrl?: string }
const KEY = 'prefs'
export async function getPrefs(): Promise<Prefs> {
  return readStorage<Prefs>(KEY, (v): v is Prefs => !!v && typeof v === 'object', {})
}
export async function setPrefs(p: Prefs): Promise<void> {
  const cur = await getPrefs()
  await browser.storage.local.set({ [KEY]: { ...cur, ...p } })
}

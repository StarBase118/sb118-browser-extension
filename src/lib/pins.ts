import browser from 'webextension-polyfill'
import { readStorage } from '@/lib/storage'
export interface Pin { label: string; url: string }
const KEY = 'pins'

export async function getPins(): Promise<Pin[]> {
  return readStorage<Pin[]>(KEY, (v): v is Pin[] => Array.isArray(v), [])
}
export async function addPin(p: Pin): Promise<Pin[]> {
  const pins = (await getPins()).filter((x) => x.url !== p.url)
  pins.unshift(p)
  const capped = pins.slice(0, 20)
  await browser.storage.local.set({ [KEY]: capped })
  return capped
}
export async function removePin(url: string): Promise<Pin[]> {
  const pins = (await getPins()).filter((x) => x.url !== url)
  await browser.storage.local.set({ [KEY]: pins })
  return pins
}

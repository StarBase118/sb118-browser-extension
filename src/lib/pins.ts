import browser from 'webextension-polyfill'
import { readStorage } from '@/lib/storage'
export interface Pin { label: string; url: string }
const KEY = 'pins'

/**
 * Longest label we will store. The chip itself is truncated visually in CSS
 * and the full label stays available as a tooltip, so this is only a guard
 * against a pathological page title filling storage — not the display width.
 */
export const MAX_PIN_LABEL = 120

/** The one place a label is normalised before it reaches storage. */
function sanitizeLabel(label: string): string {
  return label.trim().slice(0, MAX_PIN_LABEL)
}

/**
 * Normalise a hand-typed address, or return null if it isn't one we will open.
 *
 * "Pin tab" gets its url from the browser, but a member typing one will leave
 * the scheme off, so a bare `wiki.starbase118.net/...` is assumed to be https
 * rather than rejected. Only http and https are accepted — a chip is a link
 * the popup opens in a tab, so `javascript:` and `data:` must never reach it,
 * and `chrome://`/`about:` can't be opened from an extension anyway.
 */
export function normalizePinUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (!parsed.hostname) return null
  return parsed.toString()
}

export async function getPins(): Promise<Pin[]> {
  return readStorage<Pin[]>(KEY, (v): v is Pin[] => Array.isArray(v), [])
}
export async function addPin(p: Pin): Promise<Pin[]> {
  const pins = (await getPins()).filter((x) => x.url !== p.url)
  pins.unshift({ ...p, label: sanitizeLabel(p.label) })
  const capped = pins.slice(0, 20)
  await browser.storage.local.set({ [KEY]: capped })
  return capped
}
export async function removePin(url: string): Promise<Pin[]> {
  const pins = (await getPins()).filter((x) => x.url !== url)
  await browser.storage.local.set({ [KEY]: pins })
  return pins
}

/**
 * Rename the pin at `url`. Page titles are what the browser hands us and are
 * routinely far too long to read in a chip, so a member has to be able to
 * write a short one — the label is otherwise set once at creation and never
 * written again.
 *
 * A blank or whitespace-only name is treated as "leave it alone" rather than
 * as a rename to nothing, since an empty chip is unreadable. Renaming a url
 * that isn't pinned is a no-op.
 */
export async function renamePin(url: string, label: string): Promise<Pin[]> {
  const trimmed = label.trim()
  const pins = await getPins()
  if (!trimmed) return pins
  const next = pins.map((p) =>
    p.url === url ? { ...p, label: sanitizeLabel(trimmed) } : p
  )
  await browser.storage.local.set({ [KEY]: next })
  return next
}

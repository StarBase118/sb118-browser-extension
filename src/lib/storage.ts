import browser from 'webextension-polyfill'

/**
 * Read a JSON-ish value out of browser.storage.local, applying a type guard
 * and falling back to a default when the stored value is missing or invalid.
 * Shared by pins.ts and prefs.ts so the read/guard/fallback boilerplate
 * lives in one place.
 */
export async function readStorage<T>(key: string, isValid: (v: unknown) => v is T, fallback: T): Promise<T> {
  const r = await browser.storage.local.get(key)
  const v = (r as Record<string, unknown>)[key]
  return isValid(v) ? v : fallback
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prefs } from '@/lib/prefs'
const store: Record<string, unknown> = {}
vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: {
    get: vi.fn(async (k: string) => ({ [k]: store[k] })),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
  } } },
}))
import { enabledSources, getPrefs, setPrefs } from '@/lib/prefs'
beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })
describe('prefs', () => {
  it('defaults to empty object', async () => { expect(await getPrefs()).toEqual({}) })
  it('round-trips values', async () => {
    await setPrefs({ manualCharacterUrl: 'https://wiki/x' })
    expect((await getPrefs()).manualCharacterUrl).toBe('https://wiki/x')
  })
  it('merges rather than replaces', async () => {
    await setPrefs({ manualCharacterUrl: 'https://wiki/c' })
    await setPrefs({ manualShipUrl: 'https://wiki/s' })
    const p = await getPrefs()
    expect(p.manualCharacterUrl).toBe('https://wiki/c')
    expect(p.manualShipUrl).toBe('https://wiki/s')
  })

  it('enables every notification source by default in source order', () => {
    expect(enabledSources({})).toEqual(['announcements', 'sims', 'news'])
  })

  it('treats an absent notification key as enabled', () => {
    expect(enabledSources({ notifications: { news: false } })).toEqual(['announcements', 'sims'])
  })

  it('treats an explicit true notification key as enabled', () => {
    expect(enabledSources({ notifications: { news: true } })).toEqual(['announcements', 'sims', 'news'])
  })

  it('can disable every notification source', () => {
    expect(enabledSources({
      notifications: {
        announcements: false,
        sims: false,
        news: false,
      },
    })).toEqual([])
  })

  it('treats malformed notification prefs as enabled without throwing', () => {
    const prefs = { notifications: 'bad' } as unknown as Prefs
    expect(enabledSources(prefs)).toEqual(['announcements', 'sims', 'news'])
  })
})

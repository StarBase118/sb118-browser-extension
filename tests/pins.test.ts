import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
    } },
  },
}))

import { getPins, addPin, removePin } from '@/lib/pins'

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('pins', () => {
  it('starts empty', async () => { expect(await getPins()).toEqual([]) })
  it('adds and dedupes by url', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await addPin({ label: 'A2', url: 'https://x/1' })
    expect(after).toHaveLength(1)
  })
  it('removes by url', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    expect(await removePin('https://x/1')).toEqual([])
  })
  it('caps at 20', async () => {
    for (let i = 0; i < 25; i++) await addPin({ label: `p${i}`, url: `https://x/${i}` })
    expect((await getPins()).length).toBe(20)
  })
})

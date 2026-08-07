import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('webextension-polyfill', () => ({ default: {} }))
import { getProfile } from '@/lib/session'

beforeEach(() => { vi.restoreAllMocks() })

describe('getProfile', () => {
  it('returns the profile on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ authenticated: true, isStaff: false, character: { name: 'X' } }),
      { status: 200 })))
    const p = await getProfile()
    expect(p?.authenticated).toBe(true)
  })
  it('returns null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"authenticated":false}', { status: 401 })))
    expect(await getProfile()).toBeNull()
  })
  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await getProfile()).toBeNull()
  })
})

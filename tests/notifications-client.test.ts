import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchNotifications } from '@/lib/notifications-client'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => { vi.restoreAllMocks() })

describe('fetchNotifications', () => {
  it('returns sources on 200', async () => {
    const body = {
      sources: {
        announcements: {
          items: [{ id: 'a', title: 'A', url: 'https://hq.starbase118.net/a', at: '2026-08-07T16:00:00.000Z' }],
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn(async () => json(body)))

    expect(await fetchNotifications()).toEqual(body)
  })

  it('sends the session cookie and json accept header', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json({ sources: {} }))
    vi.stubGlobal('fetch', fetchFn)

    await fetchNotifications()

    expect(fetchFn.mock.calls[0][1]).toMatchObject({
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
  })

  it('returns an empty response on 401 instead of null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ authenticated: false }, 401)))
    expect(await fetchNotifications()).toEqual({ sources: {} })
  })

  it('returns null on 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)))
    expect(await fetchNotifications()).toBeNull()
  })

  it('returns null on network throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchNotifications()).toBeNull()
  })

  it('returns null on malformed body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ nope: true })))
    expect(await fetchNotifications()).toBeNull()
  })
})

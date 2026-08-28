/**
 * Integration cover for the popup wiring that Slice 3 introduced.
 *
 * The spec deferred this, on the reasoning that importing popup.ts drags in the
 * whole module graph and its DOMContentLoaded wiring. It does — but the three
 * behaviours it guards are the ones that fail silently and lose information, so
 * they are worth the harness:
 *
 *   - the marker advances ONLY when the notifications panel is actually visible
 *   - clicking a row finishes its storage write BEFORE the popup closes
 *   - every source switched off means no tab strip at all
 *
 * The real popup.html is loaded from disk rather than restated here, so the
 * element ids under test are the ones that actually ship.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The real shipped markup, not a copy — see tests/raw.d.ts.
import POPUP_HTML from '../src/popup/popup.html?raw'

const store: Record<string, unknown> = {}
const created: string[] = []
let sent: unknown[] = []

/** Resolves on the microtask AFTER the one that set it, so an awaited write lands. */
let setLastSeenCalls: unknown[] = []

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: store[k] })),
        set: vi.fn(async (o: Record<string, unknown>) => {
          Object.assign(store, o)
          if ('notifLastSeen' in o) setLastSeenCalls.push(o.notifLastSeen)
        }),
      },
    },
    tabs: {
      create: vi.fn(async ({ url }: { url: string }) => { created.push(url) }),
      query: vi.fn(async () => [{ url: 'https://example.test/', title: 'x' }]),
    },
    runtime: { sendMessage: vi.fn(async (m: unknown) => { sent.push(m) }) },
  },
}))

const AT_NEW = '2026-08-27T12:00:00.000Z'

function seedPayload() {
  store.notifItems = {
    sims: { items: [{ id: '1', title: 'A sim', url: 'https://sb118.test/sim/1', at: AT_NEW }] },
  }
}

/**
 * Load popup.ts fresh against the real markup and run its entry point once.
 *
 * The DOMContentLoaded registration is INTERCEPTED rather than dispatched.
 * Re-importing the module leaves its listener attached to the shared jsdom
 * `document`, which survives a body swap — so a plain dispatch on the fourth
 * boot fires four handlers and every call-count assertion reads garbage.
 * Capturing the handler keeps each boot to exactly one run.
 */
async function bootPopup() {
  document.body.innerHTML = POPUP_HTML
    .replace(/[\s\S]*<body>/, '')
    .replace('</body></html>', '')

  vi.resetModules()

  let entry: (() => void) | null = null
  const origAdd = document.addEventListener.bind(document)
  document.addEventListener = ((type: string, fn: EventListener, ...rest: unknown[]) => {
    if (type === 'DOMContentLoaded') { entry = fn as unknown as () => void; return }
    return (origAdd as (...a: unknown[]) => void)(type, fn, ...rest)
  }) as typeof document.addEventListener

  await import('@/popup/popup')
  document.addEventListener = origAdd

  if (!entry) throw new Error('popup.ts registered no DOMContentLoaded handler')
  ;(entry as () => void)()

  // Let the render + mount promise chain settle.
  for (let i = 0; i < 30; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  created.length = 0
  sent = []
  setLastSeenCalls = []
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, json: async () => ({}) })))
  vi.stubGlobal('close', vi.fn())
})

afterEach(() => { vi.unstubAllGlobals() })

describe('popup tabs', () => {
  it('opens on New for you when the badge count is above zero', async () => {
    seedPayload()
    store.notifCount = 1
    await bootPopup()

    expect(document.getElementById('tabs')!.hidden).toBe(false)
    expect(document.getElementById('tab-notifs')!.hidden).toBe(false)
    expect(document.getElementById('tab-launcher')!.hidden).toBe(true)
    expect(document.getElementById('tab-count')!.textContent).toBe('1')
  })

  it('opens on Launcher when nothing is new', async () => {
    seedPayload()
    store.notifLastSeen = { sims: AT_NEW }
    store.notifCount = 0
    await bootPopup()

    expect(document.getElementById('tab-launcher')!.hidden).toBe(false)
    expect(document.getElementById('tab-notifs')!.hidden).toBe(true)
    expect(document.getElementById('tab-count')!.hidden).toBe(true)
  })

  /**
   * THE marker gate — decision 4, and the one that loses information silently.
   *
   * Rendering the panel is not seeing it. An open that lands on Launcher must
   * leave the marker exactly where it was, or the badge clears for a member who
   * never looked.
   */
  it('does NOT advance the marker on an open that lands on Launcher', async () => {
    seedPayload()
    store.notifCount = 0
    store.notifLastSeen = { sims: AT_NEW }
    await bootPopup()

    expect(document.getElementById('tab-launcher')!.hidden).toBe(false)
    expect(setLastSeenCalls).toEqual([])
  })

  it('advances the marker when the panel is shown at open', async () => {
    seedPayload()
    store.notifCount = 1
    await bootPopup()

    expect(setLastSeenCalls.length).toBe(1)
    expect(store.notifLastSeen).toEqual({ sims: AT_NEW })
    expect(sent).toContainEqual({ type: 'notif:refresh' })
  })

  it('advances the marker when the member clicks through to the tab', async () => {
    seedPayload()
    store.notifCount = 0
    store.notifLastSeen = { sims: AT_NEW }
    await bootPopup()
    expect(setLastSeenCalls).toEqual([])

    document.getElementById('tab-notifs-btn')!.click()
    for (let i = 0; i < 30; i++) await Promise.resolve()

    expect(setLastSeenCalls.length).toBe(1)
  })

  it('renders no tab strip when every source is switched off', async () => {
    seedPayload()
    store.notifCount = 3
    store.prefs = { notifications: { announcements: false, sims: false, news: false } }
    await bootPopup()

    expect(document.getElementById('tabs')!.hidden).toBe(true)
    expect(document.getElementById('tab-notifs')!.hidden).toBe(true)
    expect(document.getElementById('tab-launcher')!.hidden).toBe(false)
  })
})

describe('clicking a notification row', () => {
  /**
   * Covers that the click is RECORDED at all, and that the tab opens first.
   *
   * It does NOT cover the `await`. Verified by mutation: replacing `await
   * addClicked(...)` with `void addClicked(...)` leaves this test GREEN,
   * because jsdom's `window.close()` is a no-op that does not destroy the
   * context, so a fire-and-forget write still resolves. Only a real popup
   * teardown can distinguish the two, which is why the plan's manual step 5
   * (insert a delay before the write, confirm the row still disappears) stays
   * a manual step. Do not read this test as proof the await is load-bearing.
   *
   * Replacing the handler with the old `openUrl(item.url)` DOES turn it red.
   */
  it('persists the clicked key before closing, and opens the tab first', async () => {
    seedPayload()
    store.notifCount = 1
    await bootPopup()

    const row = document.querySelector<HTMLAnchorElement>('#notiflist .n-row')!
    row.click()
    for (let i = 0; i < 30; i++) await Promise.resolve()

    expect(created).toEqual(['https://sb118.test/sim/1'])
    expect(store.notifClicked).toEqual(['sims:1'])
    expect(window.close).toHaveBeenCalled()
  })

  it('does not list a clicked item on the next open', async () => {
    seedPayload()
    store.notifCount = 1
    await bootPopup()
    document.querySelector<HTMLAnchorElement>('#notiflist .n-row')!.click()
    for (let i = 0; i < 30; i++) await Promise.resolve()

    await bootPopup()
    expect(document.querySelectorAll('#notiflist .n-row').length).toBe(0)
    expect(document.getElementById('notiflist')!.textContent).toContain('Nothing new')
  })
})

# Phase 3.1 Notification List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The popup lists the notification items behind the badge number, with the ones that are new to this member marked, instead of only showing a count.

**Architecture:** The background worker already fetches `GET /api/me/notifications` every 15 minutes to set the badge and discards the items; it now caches the payload under `notifItems`. The popup reads that cache, builds a display list through a new pure module, renders it, and only then advances the per-source last-seen markers from the exact snapshot it rendered. No HQ change, no new network path.

**Tech Stack:** TypeScript, Vite, Vitest, `webextension-polyfill`, MV3 service worker, plain DOM (no framework).

**Spec:** `docs/superpowers/specs/2026-08-13-sb118-extension-phase31-notification-list-design.md`

## Global Constraints

- **The list and the badge must never disagree about what "new" means.** Both go through one shared predicate (`isItemNew`); do not write a second copy of the comparison.
- **`notifLastSeen` has exactly one writer after this change: the popup.** The worker never advances it.
- **Never render an `unavailable` source as an empty group.** An outage must not read as "nothing here."
- **Truncation must never drop an item flagged new.** Partition first; do not sort-then-slice.
- **Corrupt cache is treated as absent, not as empty.** `getCachedItems()` returns `null` for absent, unparseable, or shape-invalid data.
- **Exact copy strings** (used in both implementation and assertions):
  - Section heading: `New for you`
  - Quiet: `Nothing new right now.`
  - Checking: `Checking for updates…` (note: single-character ellipsis `…`, not three dots)
  - Outage: `Couldn't reach HQ — this list may be out of date.` (curly apostrophe, em dash)
- **Section order in the popup:** search → quick-launch grid → **notifications** → My stuff → Pinned → Announcements → Staff → feedback.
- **Titles truncate in CSS only** (`-webkit-line-clamp: 2`), never in storage or in the builder; the full title goes on the row's `title` attribute.
- **No new dependencies.** Relative time uses `Intl.RelativeTimeFormat`.
- Every task ends green on `npm test`, `npm run typecheck`, and `npm run build`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/notification-list.ts` | **New.** Pure builder: payload + markers + enabled sources → ordered display list plus a state. No I/O, no DOM. |
| `src/lib/notification-count.ts` | Modify. Extracts `isItemNew` as the one shared new-ness predicate; `countNewForSource` calls it. |
| `src/lib/notifications-store.ts` | Modify. Adds `getCachedItems` / `setCachedItems` with null-for-absent-or-corrupt semantics. |
| `src/background.ts` | Modify. Caches the payload; `markAllSeen` and the `notif:seen` message are deleted. |
| `src/popup/popup.ts` | Modify. Renders the section, then advances the marker from the rendered snapshot. Deletes `renderNotificationIntro`. |
| `src/popup/popup.html` | Modify. Replaces `#notif-intro` with the notifications section. |
| `src/popup/popup.css` | Modify. Row styles in; `.notif-intro` styles out. |
| `src/lib/prefs.ts` | Modify. Drops the now-dead `notifIntroDismissed`. |
| `tests/notification-list.test.ts` | **New.** The builder's behaviour, including the two bugs review caught. |
| `tests/notifications-store.test.ts` | **New.** Null-versus-empty semantics. |
| `tests/notification-count.test.ts` | Modify. Confirms the extracted predicate did not change counting. |
| `scripts/e2e-notifications.mjs` | **New.** Playwright against the built extension. |

---

### Task 1: One shared new-ness predicate

Pulls the "is this item newer than the marker" decision out of `countNewForSource` so the list and the badge cannot drift apart. Behaviour must not change.

**Files:**
- Modify: `src/lib/notification-count.ts:1-40`
- Test: `tests/notification-count.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function isItemNew(item: NotificationItem, lastSeenIso: string | undefined): boolean` — true when the item is newer than the marker; **true when the marker is missing or unparseable**; false when the item's own `at` is unparseable.

- [ ] **Step 1: Write the failing test**

Append to `tests/notification-count.test.ts`:

```ts
import { isItemNew } from '@/lib/notification-count'

const item = (at: string) => ({ id: 'i', title: 't', url: 'https://x/', at })

describe('isItemNew', () => {
  it('is true when the marker is missing', () => {
    expect(isItemNew(item('2026-08-13T10:00:00Z'), undefined)).toBe(true)
  })
  it('is true when the marker will not parse', () => {
    expect(isItemNew(item('2026-08-13T10:00:00Z'), 'not-a-date')).toBe(true)
  })
  it('is false for an item exactly at the marker', () => {
    expect(isItemNew(item('2026-08-13T10:00:00Z'), '2026-08-13T10:00:00Z')).toBe(false)
  })
  it('is true one millisecond after the marker', () => {
    expect(isItemNew(item('2026-08-13T10:00:00.001Z'), '2026-08-13T10:00:00Z')).toBe(true)
  })
  it('is false when the item timestamp will not parse', () => {
    expect(isItemNew(item('garbage'), '2026-08-13T10:00:00Z')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notification-count.test.ts`
Expected: FAIL — `isItemNew` is not exported.

- [ ] **Step 3: Extract the predicate**

In `src/lib/notification-count.ts`, add the export and rewrite `countNewForSource` to use it:

```ts
export function isItemNew(item: NotificationItem, lastSeenIso: string | undefined): boolean {
  // A missing marker means this browser has never cleared the source, and an
  // unparseable one is corrupt rather than a real "seen" point. Both count as
  // new, so a bad marker cannot silently pin a source at zero while looking calm.
  if (!lastSeenIso) return true
  const lastSeenMs = parseIso(lastSeenIso)
  if (lastSeenMs === null) return true

  const itemMs = parseIso(item.at)
  return itemMs !== null && itemMs > lastSeenMs
}

export function countNewForSource(
  group: NotificationGroup | undefined,
  lastSeenIso: string | undefined
): number {
  if (!group || group.unavailable || !group.items.length) return 0
  return group.items.filter((item) => isItemNew(item, lastSeenIso)).length
}
```

Add `type NotificationItem` to the existing import from `@/lib/notifications-types`.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — all pre-existing `countNewForSource` tests still green, proving the extraction changed nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notification-count.ts tests/notification-count.test.ts
git commit -m "Extract isItemNew so the list and the badge cannot disagree"
```

---

### Task 2: Cache the payload, with null meaning "we have not looked"

**Files:**
- Modify: `src/lib/notifications-store.ts`
- Create: `tests/notifications-store.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export async function getCachedItems(): Promise<NotificationsResponse['sources'] | null>` — `null` for absent, unparseable, or shape-invalid; a payload object otherwise, **including an empty one**.
  - `export async function setCachedItems(sources: NotificationsResponse['sources']): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/notifications-store.test.ts`:

```ts
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

import { getCachedItems, setCachedItems } from '@/lib/notifications-store'

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('cached items', () => {
  it('returns null when nothing has been stored', async () => {
    expect(await getCachedItems()).toBeNull()
  })

  // Load-bearing: an empty payload is "we looked and it was quiet", which the
  // popup renders differently from "we have not looked".
  it('round-trips a valid but empty payload as empty, not null', async () => {
    await setCachedItems({})
    expect(await getCachedItems()).toEqual({})
  })

  it('round-trips a populated payload', async () => {
    const payload = {
      news: { items: [{ id: '1', title: 'A', url: 'https://x/1', at: '2026-08-13T10:00:00Z' }] },
    }
    await setCachedItems(payload)
    expect(await getCachedItems()).toEqual(payload)
  })

  it('keeps an unavailable flag', async () => {
    await setCachedItems({ sims: { items: [], unavailable: true } })
    expect((await getCachedItems())!.sims!.unavailable).toBe(true)
  })

  it.each([
    ['a string', 'nope'],
    ['an array', [1, 2]],
    ['a group that is not an object', { news: 'nope' }],
    ['items that are not an array', { news: { items: 'nope' } }],
    ['an item missing url', { news: { items: [{ id: '1', title: 'A', at: '2026-08-13T10:00:00Z' }] } }],
  ])('returns null for %s', async (_label, value) => {
    store.notifItems = value
    expect(await getCachedItems()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifications-store.test.ts`
Expected: FAIL — `getCachedItems` is not exported.

- [ ] **Step 3: Implement the accessors**

Append to `src/lib/notifications-store.ts` (and add `ALL_SOURCES`, `type NotificationsResponse` to the existing imports):

```ts
const ITEMS_KEY = 'notifItems'

function isItemShape(v: unknown): boolean {
  return (
    isPlainRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.url === 'string' &&
    typeof v.at === 'string'
  )
}

function isSourcesShape(v: unknown): v is NotificationsResponse['sources'] {
  if (!isPlainRecord(v)) return false
  return Object.entries(v).every(([source, group]) => {
    if (!ALL_SOURCES.includes(source as NotificationSource)) return false
    if (!isPlainRecord(group)) return false
    if (!Array.isArray(group.items) || !group.items.every(isItemShape)) return false
    return group.unavailable === undefined || typeof group.unavailable === 'boolean'
  })
}

/**
 * The payload the worker last fetched, or null.
 *
 * Null means "we have not successfully looked" — absent, unparseable, or the
 * wrong shape. That is deliberately NOT the same as an empty payload, which
 * means "we looked and it was quiet": the popup says "checking" for the first
 * and "nothing new" for the second, and telling a member nothing is new on the
 * strength of a cache we could not read would be a claim we have not earned.
 */
export async function getCachedItems(): Promise<NotificationsResponse['sources'] | null> {
  const r = await browser.storage.local.get(ITEMS_KEY)
  const v = (r as Record<string, unknown>)[ITEMS_KEY]
  return isSourcesShape(v) ? v : null
}

export async function setCachedItems(sources: NotificationsResponse['sources']): Promise<void> {
  await browser.storage.local.set({ [ITEMS_KEY]: sources })
}
```

Add `type NotificationSource` to the imports from `@/lib/notifications-types`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications-store.ts tests/notifications-store.test.ts
git commit -m "Cache the notification payload, with null for absent or corrupt"
```

---

### Task 3: The pure list builder

The heart of the feature, and the only place the two review-caught bugs can reappear. Pure so it can be tested against real payloads rather than mocks — the Phase 3 sims bug shipped because every test mocked the source it was meant to exercise.

**Files:**
- Create: `src/lib/notification-list.ts`
- Create: `tests/notification-list.test.ts`

**Interfaces:**
- Consumes: `isItemNew` from Task 1.
- Produces:
  - `export type NotificationListState = 'ok' | 'outage' | 'disabled'`
  - `export interface DisplayItem { id: string; title: string; url: string; at: string; source: NotificationSource; isNew: boolean }`
  - `export interface NotificationListResult { items: DisplayItem[]; state: NotificationListState }`
  - `export const LIST_CAP = 8`
  - `export function buildNotificationList(sources, lastSeen, enabled, cap?): NotificationListResult`

- [ ] **Step 1: Write the failing test**

Create `tests/notification-list.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildNotificationList } from '@/lib/notification-list'
import { ALL_SOURCES, type NotificationSource } from '@/lib/notifications-types'

const item = (id: string, at: string, title = id) => ({ id, title, url: `https://x/${id}`, at })
const ALL = ALL_SOURCES

describe('buildNotificationList', () => {
  it('merges sources newest first', () => {
    const r = buildNotificationList(
      {
        news: { items: [item('n1', '2026-08-13T09:00:00Z')] },
        sims: { items: [item('s1', '2026-08-13T11:00:00Z')] },
        announcements: { items: [item('a1', '2026-08-13T10:00:00Z')] },
      },
      {}, ALL
    )
    expect(r.items.map((i) => i.id)).toEqual(['s1', 'a1', 'n1'])
    expect(r.state).toBe('ok')
  })

  it('tags each item with its source', () => {
    const r = buildNotificationList({ sims: { items: [item('s1', '2026-08-13T11:00:00Z')] } }, {}, ALL)
    expect(r.items[0].source).toBe('sims')
  })

  it('flags new against the boundary the badge uses', () => {
    const r = buildNotificationList(
      { news: { items: [item('at', '2026-08-13T10:00:00Z'), item('after', '2026-08-13T10:00:00.001Z')] } },
      { news: '2026-08-13T10:00:00Z' }, ALL
    )
    expect(r.items.find((i) => i.id === 'at')!.isNew).toBe(false)
    expect(r.items.find((i) => i.id === 'after')!.isNew).toBe(true)
  })

  it('treats a missing marker as everything new', () => {
    const r = buildNotificationList({ news: { items: [item('n1', '2026-08-13T09:00:00Z')] } }, {}, ALL)
    expect(r.items[0].isNew).toBe(true)
  })

  it('treats an unparseable marker as everything new', () => {
    const r = buildNotificationList(
      { news: { items: [item('n1', '2026-08-13T09:00:00Z')] } },
      { news: 'garbage' }, ALL
    )
    expect(r.items[0].isNew).toBe(true)
  })

  it('skips an unavailable source instead of rendering it empty', () => {
    const r = buildNotificationList(
      { news: { items: [item('n1', '2026-08-13T09:00:00Z')] }, sims: { items: [], unavailable: true } },
      {}, ALL
    )
    expect(r.items.map((i) => i.id)).toEqual(['n1'])
    expect(r.state).toBe('ok')
  })

  it('excludes a source the member switched off', () => {
    const r = buildNotificationList(
      { news: { items: [item('n1', '2026-08-13T09:00:00Z')] }, sims: { items: [item('s1', '2026-08-13T11:00:00Z')] } },
      {}, ['news'] as NotificationSource[]
    )
    expect(r.items.map((i) => i.id)).toEqual(['n1'])
  })

  it('caps at 8 when everything is old', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      item(`n${i}`, new Date(Date.UTC(2026, 7, 13, 0, i)).toISOString()))
    const r = buildNotificationList({ news: { items } }, { news: '2026-08-14T00:00:00Z' }, ALL)
    expect(r.items).toHaveLength(8)
    expect(r.items.every((i) => !i.isNew)).toBe(true)
  })

  it('exceeds the cap rather than dropping a new item', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item(`n${i}`, new Date(Date.UTC(2026, 7, 13, 0, i)).toISOString()))
    const r = buildNotificationList({ news: { items } }, {}, ALL)
    expect(r.items).toHaveLength(12)
  })

  // The bug a sort-then-slice would ship. Markers are PER SOURCE, so a read sim
  // from five hours ago is chronologically above an unread news item from two
  // days ago; slicing a time-sorted list at the cap drops the unread one.
  it('keeps an unread item that is older than the read items filling the cap', () => {
    const sims = Array.from({ length: 10 }, (_, i) =>
      item(`s${i}`, new Date(Date.UTC(2026, 7, 13, 5, i)).toISOString()))
    const r = buildNotificationList(
      {
        sims: { items: sims },
        news: { items: [item('unread-news', '2026-08-11T00:00:00Z')] },
      },
      { sims: '2026-08-13T23:00:00Z', news: '2026-08-10T00:00:00Z' },
      ALL
    )
    expect(r.items.map((i) => i.id)).toContain('unread-news')
    expect(r.items[0].id).toBe('unread-news')
    expect(r.items[0].isNew).toBe(true)
  })

  it('sorts an unparseable timestamp last without dropping it', () => {
    const r = buildNotificationList(
      { news: { items: [item('bad', 'garbage'), item('good', '2026-08-13T09:00:00Z')] } },
      { news: '2026-08-14T00:00:00Z' }, ALL
    )
    expect(r.items.map((i) => i.id)).toEqual(['good', 'bad'])
  })

  it('reports an outage only when every enabled source failed and nothing survived', () => {
    const r = buildNotificationList(
      { news: { items: [], unavailable: true }, sims: { items: [], unavailable: true },
        announcements: { items: [], unavailable: true } },
      {}, ALL
    )
    expect(r.state).toBe('outage')
  })

  it('is ok, not an outage, when sources are healthy but quiet', () => {
    const r = buildNotificationList({ news: { items: [] } }, {}, ALL)
    expect(r.state).toBe('ok')
    expect(r.items).toEqual([])
  })

  // The disabled check must come first, or someone who switched everything off
  // is told HQ is broken.
  it('is disabled, not an outage, when no sources are enabled', () => {
    const r = buildNotificationList(
      { news: { items: [], unavailable: true } }, {}, []
    )
    expect(r.state).toBe('disabled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notification-list.test.ts`
Expected: FAIL — cannot resolve `@/lib/notification-list`.

- [ ] **Step 3: Implement the builder**

Create `src/lib/notification-list.ts`:

```ts
import { isItemNew } from '@/lib/notification-count'
import type {
  LastSeen,
  NotificationSource,
  NotificationsResponse,
} from '@/lib/notifications-types'

export type NotificationListState =
  | 'ok' // render the items, which may legitimately be none
  | 'outage' // every enabled source failed
  | 'disabled' // the member switched every source off

export interface DisplayItem {
  id: string
  title: string
  url: string
  at: string
  source: NotificationSource
  isNew: boolean
}

export interface NotificationListResult {
  items: DisplayItem[]
  state: NotificationListState
}

/** Old items shown alongside the new ones. New items are never capped away. */
export const LIST_CAP = 8

function timeOf(iso: string): number {
  const ms = Date.parse(iso)
  // An item whose timestamp will not parse is still a real thing that
  // happened, so it sorts last rather than being dropped.
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

function newestFirst(a: DisplayItem, b: DisplayItem): number {
  return timeOf(b.at) - timeOf(a.at)
}

/**
 * Turn the cached payload into the ordered list the popup renders.
 *
 * The truncation is a PARTITION, not a sort-then-slice, and that is the whole
 * reason this function exists separately from the render. Markers are per
 * source, so "new" is not a function of absolute time across the merged list:
 * if the sims marker is an hour old and the news marker is three days old, a
 * read sim from five hours ago sorts above an unread news item from two days
 * ago. Slicing a time-sorted list at the cap would therefore drop unread items
 * to make room for read ones — the exact failure this phase exists to prevent.
 */
export function buildNotificationList(
  sources: NotificationsResponse['sources'],
  lastSeen: LastSeen,
  enabled: NotificationSource[],
  cap: number = LIST_CAP
): NotificationListResult {
  // Checked before anything else: an emptiness test written first would report
  // an outage to a member who simply switched every source off.
  if (!enabled.length) return { items: [], state: 'disabled' }

  const fresh: DisplayItem[] = []
  const seen: DisplayItem[] = []
  let anyAvailable = false

  for (const source of enabled) {
    const group = sources[source]
    if (!group || group.unavailable) continue
    anyAvailable = true

    for (const item of group.items) {
      const display: DisplayItem = { ...item, source, isNew: isItemNew(item, lastSeen[source]) }
      ;(display.isNew ? fresh : seen).push(display)
    }
  }

  if (!anyAvailable) return { items: [], state: 'outage' }

  fresh.sort(newestFirst)
  seen.sort(newestFirst)

  return {
    items: [...fresh, ...seen.slice(0, Math.max(0, cap - fresh.length))],
    state: 'ok',
  }
}
```

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notification-list.ts tests/notification-list.test.ts
git commit -m "Add the notification list builder, partitioning new from old"
```

---

### Task 4: The worker caches the payload and stops owning read state

**Files:**
- Modify: `src/background.ts`
- Test: `tests/background.test.ts`

**Interfaces:**
- Consumes: `setCachedItems` from Task 2.
- Produces: `refreshBadge()` unchanged in signature. **`markAllSeen()` no longer exists**, and the `notif:seen` message is no longer handled — Task 5's popup writes the marker instead.

- [ ] **Step 1: Write the failing test**

`tests/background.test.ts` mocks `@/lib/notifications-store` wholesale, so the new accessor
has to be added to three places: the `vi.hoisted` mocks object, the `vi.mock` factory, and
the `beforeEach` defaults.

In the `vi.hoisted({...})` block, add beside `setCachedCount`:

```ts
  setCachedItems: vi.fn(),
```

In the `vi.mock('@/lib/notifications-store', ...)` factory, add:

```ts
  setCachedItems: mocks.setCachedItems,
```

Remove `setLastSeen` from **both** — the worker no longer writes the marker.

In `beforeEach`, add:

```ts
  mocks.setCachedItems.mockResolvedValue(undefined)
```

Change the import line from `import { markAllSeen, refreshBadge } from '@/background'` to
`import { refreshBadge } from '@/background'`.

Then add these tests inside `describe('background notification badge', ...)`:

```ts
it('caches the payload it fetched', async () => {
  const sources = {
    news: {
      items: [
        { id: 'n1', title: 'N1', url: 'https://hq.starbase118.net/n1', at: '2026-08-07T18:00:00.000Z' },
      ],
    },
  }
  mocks.fetchNotifications.mockResolvedValue(response(sources))

  await refreshBadge()

  expect(mocks.setCachedItems).toHaveBeenCalledWith(sources)
})

// A transient HQ failure must not blank a list the member could still read.
it('leaves the cache alone when a poll cannot look', async () => {
  mocks.fetchNotifications.mockResolvedValue(null)

  await refreshBadge()

  expect(mocks.setCachedItems).not.toHaveBeenCalled()
})

it('no longer handles notif:seen', async () => {
  const results = mocks.messageListeners.map((cb) => cb({ type: 'notif:seen' }))
  expect(results).toEqual([undefined])
})
```

**Delete every existing test that imports or exercises `markAllSeen`.** That behaviour moved
to the popup and is covered by Task 5 and the end-to-end checks in Task 6; leaving a skipped
test behind would imply the worker still owns read state.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/background.test.ts`
Expected: FAIL — the cache is never written.

- [ ] **Step 3: Cache the payload and delete `markAllSeen`**

In `src/background.ts`:

```ts
export async function refreshBadge(): Promise<void> {
  const enabled = enabledSources(await getPrefs())
  const res = await fetchNotifications(enabled)

  // `null` means the worker could not look at all. Leave the existing badge AND
  // the existing cache alone, so a transient HQ failure neither falsely clears
  // activity nor blanks a list the member could still usefully read.
  if (!res) return

  await setCachedItems(res.sources)
  const total = countNew(res.sources, await getLastSeen(), enabled)
  await setCachedCount(total)
  await setBadge(total)
}
```

Delete the whole `markAllSeen` function and its `notif:seen` branch, leaving:

```ts
browser.runtime.onMessage.addListener((message: unknown, _sender: Runtime.MessageSender) => {
  if (typeof message !== 'object' || message === null || !('type' in message)) return undefined
  if (message.type === 'notif:refresh') return refreshBadge()
  return undefined
})
```

Update the imports: drop `advanceLastSeen` and `setLastSeen`, add `setCachedItems`.

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Any existing `markAllSeen` test is deleted in this step, not skipped — the behaviour moved to the popup and is covered there.

- [ ] **Step 5: Commit**

```bash
git add src/background.ts tests/background.test.ts
git commit -m "Cache the payload in the worker and hand read state to the popup"
```

---

### Task 5: Render the section and advance the marker from what was rendered

**Files:**
- Modify: `src/popup/popup.html:11`
- Modify: `src/popup/popup.ts:11-12,350-385,473-483`
- Modify: `src/popup/popup.css:53-59`
- Modify: `src/lib/prefs.ts:9`

**Interfaces:**
- Consumes: `buildNotificationList`, `LIST_CAP`, `DisplayItem` (Task 3); `getCachedItems` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the explainer element with the section**

In `src/popup/popup.html`, delete the `#notif-intro` line and add the section **between the grid and `#mystuff`**:

```html
  <nav id="grid" class="grid" aria-label="Quick launch"></nav>
  <section id="notifs" class="sec" hidden><span class="lbl">New for you</span><div id="notiflist" class="notiflist"></div></section>
  <section id="mystuff" class="sec" hidden>…
```

- [ ] **Step 2: Add the row styles, remove the explainer styles**

In `src/popup/popup.css`, delete the five `.notif-intro` rules (lines 53–59) and add beside the chip styles:

```css
/* Notification rows. The dot column keeps its width when a row is not new, so
   titles stay aligned down the list rather than stepping in and out. */
.notiflist{margin-top:9px}
.n-row{display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #1a2240;
  color:var(--ink);text-decoration:none}
.n-row:last-child{border-bottom:0}
.n-row:hover{background:#131b36}
.n-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;margin-top:5px;background:transparent}
.n-row.is-new .n-dot{background:var(--gold);box-shadow:0 0 5px rgba(208,162,74,.7)}
.n-body{min-width:0}
.n-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  line-height:1.35}
.n-meta{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.n-src{font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;
  color:var(--staff-accent)}
.n-note{color:var(--muted);font-size:12px;padding:4px 0}
```

- [ ] **Step 3: Write the render**

In `src/popup/popup.ts`, delete `renderNotificationIntro()` entirely and add:

```ts
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
  ['hour', 3600000], ['minute', 60000],
]

/**
 * A relative time, or null when the timestamp will not parse — passing NaN to
 * the formatter yields "NaN days ago" or throws mid-render. The item is still
 * listed and still clickable; only its time is missing, because only its time
 * is broken.
 */
function relativeTime(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const diff = ms - Date.now()
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return RELATIVE.format(Math.round(diff / size), unit)
  }
  return RELATIVE.format(0, 'minute')
}

function buildNotifRow(item: DisplayItem): HTMLAnchorElement {
  const a = document.createElement('a')
  a.className = item.isNew ? 'n-row is-new' : 'n-row'
  a.href = item.url
  a.title = item.title

  const dot = document.createElement('span')
  dot.className = 'n-dot'
  if (item.isNew) dot.setAttribute('aria-label', 'New')

  const body = document.createElement('span')
  body.className = 'n-body'

  const title = document.createElement('span')
  title.className = 'n-title'
  title.textContent = item.title

  const meta = document.createElement('span')
  meta.className = 'n-meta'
  const src = document.createElement('span')
  src.className = 'n-src'
  src.textContent = NOTIF_SOURCE_LABELS[item.source]
  meta.appendChild(src)
  const when = relativeTime(item.at)
  if (when) meta.appendChild(document.createTextNode(` · ${when}`))

  body.append(title, meta)
  a.append(dot, body)
  a.addEventListener('click', (e) => { e.preventDefault(); openUrl(item.url) })
  return a
}

function notifNote(text: string): HTMLElement {
  const p = document.createElement('div')
  p.className = 'n-note'
  p.textContent = text
  return p
}

/**
 * Render the section, then advance the marker.
 *
 * The order is the feature. The new-set is computed from the marker as it
 * stands, rendered, and only then does the marker move — so the items the
 * badge was counting are still dotted when the member looks at them, and are
 * clear next time.
 *
 * The popup advances the marker itself rather than asking the worker to,
 * because only the popup knows which snapshot was on screen: a worker reading
 * the cache when a message arrives reads it later, and a poll landing in
 * between would mark an item seen that was never displayed.
 */
async function renderNotifications(): Promise<void> {
  const section = document.getElementById('notifs')!
  const box = document.getElementById('notiflist')!
  box.innerHTML = ''

  const [cached, prefs] = await Promise.all([getCachedItems(), getPrefs()])
  const enabled = enabledSources(prefs)

  if (!enabled.length) { section.hidden = true; return }
  section.hidden = false

  if (cached === null) {
    box.appendChild(notifNote('Checking for updates…'))
    void browser.runtime.sendMessage({ type: 'notif:refresh' }).catch(() => {})
    return
  }

  const lastSeen = await getLastSeen()
  const { items, state } = buildNotificationList(cached, lastSeen, enabled)

  if (state === 'disabled') { section.hidden = true; return }
  if (state === 'outage') {
    box.appendChild(notifNote('Couldn’t reach HQ — this list may be out of date.'))
    return
  }
  if (!items.length) {
    box.appendChild(notifNote('Nothing new right now.'))
    return
  }

  for (const item of items) box.appendChild(buildNotifRow(item))

  // Only now, and only from the payload just rendered.
  await setLastSeen(advanceLastSeen(lastSeen, cached, enabled))
  void browser.runtime.sendMessage({ type: 'notif:refresh' }).catch(() => {
    // The worker may be asleep; the next alarm reconciles the badge.
  })
}
```

Update the imports at the top of `popup.ts`:

```ts
import { getCachedItems, getLastSeen, setLastSeen } from '@/lib/notifications-store'
import { advanceLastSeen } from '@/lib/notification-count'
import { buildNotificationList, type DisplayItem } from '@/lib/notification-list'
import { SOURCE_LABELS as NOTIF_SOURCE_LABELS } from '@/lib/notifications-types'
import { getPrefs, setPrefs, enabledSources } from '@/lib/prefs'
```

Drop the now-unused `getCachedCount` import.

- [ ] **Step 4: Rewire the bootstrap**

Replace the `DOMContentLoaded` block's notification half:

```ts
document.addEventListener('DOMContentLoaded', () => {
  renderGrid(document.getElementById('grid')!, MEMBER_LINKS)
  wireReportIssue()
  wireSearch()
  Promise.all([renderPins(), personalize(), renderNotifications()])
})
```

- [ ] **Step 5: Drop the dead pref**

In `src/lib/prefs.ts`, delete the `notifIntroDismissed?: boolean` line from `Prefs`. Existing stored values are harmless — `setPrefs` spreads whatever is there — and no code reads the key any more.

- [ ] **Step 6: Run tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Delete any test asserting the explainer's behaviour; the element is gone.

- [ ] **Step 7: Commit**

```bash
git add src/popup src/lib/prefs.ts
git commit -m "List the notifications in the popup, and mark them seen after rendering"
```

---

### Task 6: End-to-end against the built extension

Unit tests cannot catch a section rendered into the wrong element, a click that navigates the popup instead of opening a tab, or a marker written at the wrong moment. This drives the real build in Chromium, the same harness used for the v0.2.2 add-link work.

**Files:**
- Create: `scripts/e2e-notifications.mjs`

**Interfaces:**
- Consumes: the built `dist/chromium`.
- Produces: nothing.

- [ ] **Step 1: Write the script**

Create `scripts/e2e-notifications.mjs`:

```js
// End-to-end checks for the notification list, against the real built
// extension. Run: node scripts/e2e-notifications.mjs dist/chromium
// Chromium must be headed — headless does not start MV3 service workers.
import { chromium } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXT = process.argv[2] ?? 'dist/chromium'
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'sb118-')), {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
const id = new URL(sw.url()).host
const POPUP = `chrome-extension://${id}/popup/popup.html`

let failed = 0
const check = (ok, msg) => { if (!ok) { console.error('FAIL:', msg); failed++ } else console.log('ok —', msg) }

const iso = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const seed = async (page, state) => page.evaluate(
  (s) => new Promise((r) => chrome.storage.local.set(s, r)), state)
const read = async (page, key) => page.evaluate(
  (k) => new Promise((r) => chrome.storage.local.get(k, (o) => r(o[k]))), key)

const open = async () => { const p = await ctx.newPage(); await p.goto(POPUP); return p }

// 1. Rows render, newest first, with only the unread ones dotted.
{
  const page = await open()
  await seed(page, {
    notifItems: { news: { items: [
      { id: 'new1', title: 'Newer news', url: 'https://x/new1', at: iso(1) },
      { id: 'old1', title: 'Older news', url: 'https://x/old1', at: iso(48) },
    ] } },
    notifLastSeen: { news: iso(24) },
  })
  await page.reload()
  await page.waitForSelector('#notiflist .n-row')
  const ids = await page.$$eval('#notiflist .n-row', (rows) => rows.map((r) => r.className))
  check(ids.length === 2, 'two rows render')
  check(ids[0].includes('is-new') && !ids[1].includes('is-new'), 'only the unread row is dotted')
  const href = await page.$eval('#notiflist .n-row', (r) => r.getAttribute('href'))
  check(href === 'https://x/new1', 'the row links to the item url')
  await page.close()
}

// 2. The marker is advanced from the RENDERED snapshot, not a later cache.
{
  const page = await open()
  await seed(page, {
    notifItems: { news: { items: [{ id: 'a', title: 'A', url: 'https://x/a', at: iso(5) }] } },
    notifLastSeen: {},
  })
  await page.reload()
  await page.waitForSelector('#notiflist .n-row')
  // Something the member never saw arrives while the popup is open.
  await seed(page, { notifItems: { news: { items: [
    { id: 'a', title: 'A', url: 'https://x/a', at: iso(5) },
    { id: 'b', title: 'B', url: 'https://x/b', at: iso(1) },
  ] } } })
  await page.close()

  const next = await open()
  await next.waitForSelector('#notiflist .n-row')
  const rows = await next.$$eval('#notiflist .n-row',
    (rs) => rs.map((r) => ({ id: r.getAttribute('href'), isNew: r.className.includes('is-new') })))
  check(rows.find((r) => r.id === 'https://x/b')?.isNew === true,
    'an item that arrived unseen is still unread on the next open')
  await next.close()
}

// 3. Empty states, each distinct.
for (const [label, state, expected] of [
  ['no cache at all', { notifLastSeen: {} }, 'Checking for updates…'],
  ['a corrupt cache', { notifItems: 'garbage' }, 'Checking for updates…'],
  ['a healthy empty cache', { notifItems: {} }, 'Nothing new right now.'],
  ['every source unavailable', { notifItems: {
    news: { items: [], unavailable: true }, sims: { items: [], unavailable: true },
    announcements: { items: [], unavailable: true } } },
    'Couldn’t reach HQ — this list may be out of date.'],
]) {
  const page = await open()
  await page.evaluate(() => new Promise((r) => chrome.storage.local.clear(r)))
  await seed(page, state)
  await page.reload()
  await page.waitForSelector('#notiflist .n-note')
  const text = await page.$eval('#notiflist .n-note', (n) => n.textContent)
  check(text === expected, `${label} → "${expected}"`)
  await page.close()
}

// 4. Every source switched off hides the section rather than showing an outage.
{
  const page = await open()
  await page.evaluate(() => new Promise((r) => chrome.storage.local.clear(r)))
  await seed(page, {
    notifItems: {}, prefs: { notifications: { news: false, sims: false, announcements: false } },
  })
  await page.reload()
  await page.waitForSelector('#notifs')
  check(await page.$eval('#notifs', (s) => s.hidden), 'the section is hidden when all sources are off')
  await page.close()
}

await ctx.close()
console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS')
process.exit(failed ? 1 : 0)
```

- [ ] **Step 2: Build and run it**

```bash
npm run build
node scripts/e2e-notifications.mjs dist/chromium
```

Expected: `RESULT: PASS`, with every `ok —` line printed. If Playwright is not installed locally, install it without saving: `npm install playwright --no-save`.

- [ ] **Step 3: Fix anything it catches, then re-run**

A failure here is a real finding, not a flaky test to retry. Fix the source, `npm run build`, run again.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-notifications.mjs
git commit -m "End-to-end checks for the notification list against the real build"
```

---

### Task 7: Release v0.3.0 and update the docs

**Files:**
- Modify: `package.json`, `src/manifest.chromium.json`, `src/manifest.firefox.json`
- Modify: `CLAUDE.md`, `ROADMAP.md`, `README.md`, `docs/STAFF-TEST.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Bump all three version files to 0.3.0**

```bash
sed -i '' 's/"version": "0.2.2"/"version": "0.3.0"/' package.json src/manifest.chromium.json src/manifest.firefox.json
grep '"version"' package.json src/manifest.*.json
```

A minor bump, not a patch: this adds a feature and removes the first-run explainer.

- [ ] **Step 2: Update the docs**

- `ROADMAP.md` — tick Phase 3.1, and remove the "known gap testers will hit" paragraph, which is no longer true.
- `CLAUDE.md` — a v0.3.0 section covering: the popup renders the worker's cache; the popup is the sole writer of `notifLastSeen` and why (a worker cannot know which snapshot was on screen); the partition-not-slice rule and the per-source-marker reason behind it; `getCachedItems()` returning null for absent-or-corrupt versus an empty payload; and that the first-run explainer and `markAllSeen()` were deleted.
- `docs/STAFF-TEST.md` — replace the "the popup does not list them yet" known-gap wording with what to look at now.
- `README.md` — bump the version line.

- [ ] **Step 3: Verify the whole gate**

```bash
npm test && npm run typecheck && npm run build && npm run package
node scripts/e2e-notifications.mjs dist/chromium
```

Expected: all green, both 0.3.0 zips in `release/`.

- [ ] **Step 4: Commit and open the PR**

```bash
git add -A
git commit -m "Cut v0.3.0 — the popup lists what the badge counted"
git push -u origin phase-31-notification-list
```

Open the PR against `main` and **stop there.** Codex does not merge; Claude reads the diff and merges. Per `.claude/rules/autonomous-dev-safety.md`, the release, the tag and any post to Discourse topic 4180 need Jordan's explicit go-ahead.

---

## Notes for the reviewer

Read these lines in the merged diff specifically. Both were caught in spec review rather than by a test, and a green suite is not evidence either survived:

1. **`buildNotificationList` must partition, not slice.** If the merged list is sorted by time and then truncated, unread items from a quiet source are dropped in favour of read items from a busy one. The test named `keeps an unread item that is older than the read items filling the cap` is the one that proves it; check the implementation actually partitions rather than that the test merely passes.
2. **`setLastSeen` must be called after the rows are appended, and from `cached`** — the payload rendered — never from a fresh read or a fresh fetch. Grep the merged branch for `setLastSeen` and confirm there is exactly one call site and it is in the popup.
3. **`markAllSeen` and `notif:seen` must be gone**, not merely unused. Two writers of read state is the bug that was designed out.

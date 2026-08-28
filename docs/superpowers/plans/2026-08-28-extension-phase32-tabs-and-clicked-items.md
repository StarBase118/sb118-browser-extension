# Phase 3.2 Implementation Plan — notification tab, and clicked items that stay gone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the popup into a Launcher tab and a New-for-you tab, and stop showing notification items the member has already clicked.

**Architecture:** Three pure library changes (a clicked-key store, a clicked filter on the list builder, a default-tab function), one new self-contained DOM module that owns the tab strip, then the popup wiring that connects them. The marker that clears the badge moves from "the list rendered" to "the panel became visible."

**Tech Stack:** TypeScript (strict), Vite, Vitest, `webextension-polyfill`, MV3 (Chromium + Firefox manifests).

**Spec:** `docs/superpowers/specs/2026-08-28-sb118-extension-phase32-tabs-and-clicked-items-design.md`

## Global Constraints

- **No new dependencies.** `jsdom` and `vitest` are already devDependencies, and `vitest.config.ts` already sets `environment: 'jsdom'` globally for every test. Do not add packages and do not touch the vitest config.
- **Path alias is `@/` → `src/`** (`vite.config.ts`). Import as `@/lib/notification-list`, never a relative `../../lib/...`.
- **Every command runs from the repo root:** `npm test`, `npm run typecheck`, `npm run build`.
- **All three must pass before any commit:** `npm test` AND `npm run typecheck` AND `npm run build`.
- **Never `git commit --no-verify`.** Never merge; never push to `main`. Open nothing — Claude handles branching, PR and merge.
- **`NotificationItem.id` is only unique within a source.** Every clicked key is `` `${source}:${id}` ``. A bare `id` anywhere in this work is a bug.
- **Do not touch** `src/background.ts`, `src/lib/notification-count.ts`, `src/lib/prefs.ts`, `src/lib/search*.ts`, `src/lib/pins.ts`, or anything under `scripts/`.
- **`popup.ts` already has functions named `showLauncher()` and `showResults()`.** They toggle the search-results view and are unrelated to tabs. Do not rename, reuse, or overload them. The tab API is `TabStrip.show(tab)`.
- **Version stays `0.3.0` in this work.** Claude bumps it at release time.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/notifications-store.ts` (modify) | Adds the `notifClicked` key: `clickedKey`, `getClicked`, `addClicked`, `pruneClicked`. Storage only. |
| `src/lib/notification-list.ts` (modify) | Adds the `clicked` filter to `buildNotificationList`, plus `PopupTab` and `selectDefaultTab`. Pure. |
| `src/popup/tab-strip.ts` (create) | Owns the tab strip DOM: visibility, `aria-selected`, roving `tabindex`, arrow-key activation, `onShow` callback. Imports no popup code, so it is testable under jsdom alone. |
| `src/popup/popup.html` (modify) | Tab strip + two panels inside `#launcher`. |
| `src/popup/popup.css` (modify) | `.tabs`, `.tab`, `.tab-count`. |
| `src/popup/popup.ts` (modify) | Wires the above; moves the marker write; awaits the click write. |
| `tests/notifications-store.test.ts` (modify) | Clicked-key storage and pruning. |
| `tests/notification-list.test.ts` (modify) | Clicked filtering, backfill, `selectDefaultTab`. |
| `tests/tab-strip.test.ts` (create) | jsdom: visibility, ARIA, keyboard, and the no-rerender invariant. |

---

# SLICE 1 — the clicked set and the list filter

Pure modules only. No DOM, no popup changes. Five commits.

### Task 1: Store the clicked keys

**Files:**
- Modify: `src/lib/notifications-store.ts`
- Test: `tests/notifications-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `clickedKey(source: NotificationSource, id: string): string`, `getClicked(): Promise<string[]>`, `addClicked(key: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/notifications-store.test.ts`. Note the existing file already mocks `webextension-polyfill` with a `store` object and clears it in `beforeEach` — reuse that, do not add a second mock.

Add `clickedKey`, `getClicked`, `addClicked` to the existing import block at the top of the file.

```ts
describe('clicked keys', () => {
  it('keys by source and id, never the bare id', () => {
    expect(clickedKey('announcements', '1')).toBe('announcements:1')
    expect(clickedKey('news', '1')).toBe('news:1')
    expect(clickedKey('announcements', '1')).not.toBe(clickedKey('news', '1'))
  })

  it('defaults to an empty list', async () => {
    expect(await getClicked()).toEqual([])
  })

  it('round-trips a clicked key', async () => {
    await addClicked('sims:42')
    expect(await getClicked()).toEqual(['sims:42'])
  })

  it('stores a repeated key once', async () => {
    await addClicked('sims:42')
    await addClicked('sims:42')
    expect(await getClicked()).toEqual(['sims:42'])
  })

  // A half-written or hand-edited value must not throw on read; the member
  // simply sees rows they had dismissed, which is recoverable by clicking again.
  it('ignores malformed clicked storage', async () => {
    store.notifClicked = 'sims:42'
    expect(await getClicked()).toEqual([])
    store.notifClicked = ['sims:42', 7]
    expect(await getClicked()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/notifications-store.test.ts`
Expected: FAIL — `clickedKey is not a function` (or an import resolution error).

- [ ] **Step 3: Implement**

In `src/lib/notifications-store.ts`, add next to the existing key constants:

```ts
const CLICKED_KEY = 'notifClicked'
```

and add these exports at the end of the file:

```ts
/**
 * `${source}:${id}` — never the bare id.
 *
 * NotificationItem.id is only unique WITHIN a source, so a sim and a Community
 * News item can both legitimately be "1234". Keying on the bare id would hide
 * an unrelated row in another source, rarely enough to look like a ghost.
 */
export function clickedKey(source: NotificationSource, id: string): string {
  return `${source}:${id}`
}

function isClickedList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((k) => typeof k === 'string')
}

export async function getClicked(): Promise<string[]> {
  return readStorage(CLICKED_KEY, isClickedList, [])
}

export async function addClicked(key: string): Promise<void> {
  const current = await getClicked()
  if (current.includes(key)) return
  await browser.storage.local.set({ [CLICKED_KEY]: [...current, key] })
}
```

`NotificationSource` is already imported at the top of this file; leave that import as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/notifications-store.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Verify the full gate, then commit**

```bash
npm test && npm run typecheck && npm run build
git add src/lib/notifications-store.ts tests/notifications-store.test.ts
git commit -m "feat(notifications): remember which items have been clicked"
```

**Report:** commit hash + 2 bullets.

---

### Task 2: Prune only against healthy sources

**Files:**
- Modify: `src/lib/notifications-store.ts`
- Test: `tests/notifications-store.test.ts`

**Interfaces:**
- Consumes: `getClicked`, `clickedKey` from Task 1.
- Produces: `pruneClicked(sources: NotificationsResponse['sources']): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add `pruneClicked` to the import block. Append:

```ts
describe('pruning clicked keys', () => {
  const healthy = {
    announcements: { items: [{ id: '1', title: 'a', url: 'u', at: '2026-08-20T00:00:00.000Z' }] },
    sims: { items: [{ id: '9', title: 's', url: 'u', at: '2026-08-20T00:00:00.000Z' }] },
  }

  it('drops a key whose item is gone and keeps one that is still there', async () => {
    store.notifClicked = ['announcements:1', 'announcements:99']
    await pruneClicked(healthy)
    expect(await getClicked()).toEqual(['announcements:1'])
  })

  // THE outage case. A source that failed says nothing about what the member
  // dismissed; deleting its keys makes every dismissed row reappear when it
  // recovers.
  it('keeps every key of a source flagged unavailable', async () => {
    store.notifClicked = ['announcements:1', 'announcements:99', 'sims:404']
    await pruneClicked({
      announcements: { items: [], unavailable: true },
      sims: { items: [{ id: '9', title: 's', url: 'u', at: '2026-08-20T00:00:00.000Z' }] },
    })
    expect((await getClicked()).sort()).toEqual(['announcements:1', 'announcements:99'])
  })

  it('keeps every key of a source missing from the payload', async () => {
    store.notifClicked = ['news:5', 'sims:9']
    await pruneClicked(healthy)
    expect((await getClicked()).sort()).toEqual(['news:5', 'sims:9'])
  })

  it('drops keys of a healthy source that is simply empty', async () => {
    store.notifClicked = ['sims:9']
    await pruneClicked({ sims: { items: [] } })
    expect(await getClicked()).toEqual([])
  })

  it('leaves storage alone when nothing needs dropping', async () => {
    store.notifClicked = ['announcements:1']
    await pruneClicked(healthy)
    expect(await getClicked()).toEqual(['announcements:1'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/notifications-store.test.ts`
Expected: FAIL — `pruneClicked is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/notifications-store.ts`:

```ts
/**
 * Drop stored keys whose item is no longer in the payload.
 *
 * ONLY keys belonging to a healthy source are eligible. A source that is
 * absent from the payload, or flagged `unavailable`, keeps every key it has —
 * otherwise one Discord outage un-dismisses every announcement the member has
 * already read, and they all reappear when the source recovers.
 */
export async function pruneClicked(sources: NotificationsResponse['sources']): Promise<void> {
  const current = await getClicked()
  if (!current.length) return

  const healthy = new Set<string>()
  const live = new Set<string>()
  for (const source of ALL_SOURCES) {
    const group = sources[source]
    if (!group || group.unavailable) continue
    healthy.add(source)
    for (const item of group.items) live.add(clickedKey(source, item.id))
  }

  // A key under a sick or missing source is not evidence of anything, so it
  // survives untouched.
  const next = current.filter((key) => {
    const source = key.slice(0, key.indexOf(':'))
    return !healthy.has(source) || live.has(key)
  })

  if (next.length === current.length) return
  await browser.storage.local.set({ [CLICKED_KEY]: next })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/notifications-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the full gate, then commit**

```bash
npm test && npm run typecheck && npm run build
git add src/lib/notifications-store.ts tests/notifications-store.test.ts
git commit -m "feat(notifications): prune clicked keys only against healthy sources"
```

**Report:** commit hash + 2 bullets.

---

### Task 3: Filter clicked items out of the list

**Files:**
- Modify: `src/lib/notification-list.ts`
- Test: `tests/notification-list.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the key format is reproduced here as a plain string).
- Produces: `buildNotificationList(sources, lastSeen, enabled, clicked?, cap?)` — `clicked` is a `ReadonlySet<string>` defaulting to `new Set()`, `cap` keeps its existing default of `LIST_CAP`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/notification-list.test.ts`. Match the fixture style already in that file.

```ts
describe('clicked items', () => {
  const at = (d: string) => `2026-08-${d}T00:00:00.000Z`
  const marker = { news: at('01') } // everything below is newer, so all are "fresh"

  it('leaves the result unchanged when nothing is clicked', () => {
    const sources = {
      news: { items: [{ id: '1', title: 'one', url: 'u1', at: at('10') }] },
    }
    const { items } = buildNotificationList(sources, marker, ['news'])
    expect(items.map((i) => i.id)).toEqual(['1'])
  })

  it('drops a clicked item', () => {
    const sources = {
      news: {
        items: [
          { id: '1', title: 'one', url: 'u1', at: at('10') },
          { id: '2', title: 'two', url: 'u2', at: at('09') },
        ],
      },
    }
    const { items } = buildNotificationList(sources, marker, ['news'], new Set(['news:1']))
    expect(items.map((i) => i.id)).toEqual(['2'])
  })

  // source:id isolation. Clicking announcements:1 must not hide news:1.
  it('does not hide a same-id item in another source', () => {
    const sources = {
      announcements: { items: [{ id: '1', title: 'ann', url: 'ua', at: at('10') }] },
      news: { items: [{ id: '1', title: 'news', url: 'un', at: at('09') }] },
    }
    const { items } = buildNotificationList(
      sources,
      { announcements: at('01'), news: at('01') },
      ['announcements', 'news'],
      new Set(['announcements:1'])
    )
    expect(items.map((i) => `${i.source}:${i.id}`)).toEqual(['news:1'])
  })

  /**
   * THE backfill case, and the reason the filter runs BEFORE the partition.
   *
   * FIXTURE SIZE IS LOAD-BEARING: three seen items against a cap of two is the
   * minimum that can tell filter-before-partition from filter-after. With two
   * items there is no third to backfill from and the mutated code passes.
   * Do not shrink this fixture — re-run the mutation if you are tempted.
   */
  it('backfills when a clicked item is removed from the seen half', () => {
    const seenMarker = { news: at('20') } // every item below is older => "seen"
    const sources = {
      news: {
        items: [
          { id: '1', title: 'one', url: 'u1', at: at('12') },
          { id: '2', title: 'two', url: 'u2', at: at('11') },
          { id: '3', title: 'three', url: 'u3', at: at('10') },
        ],
      },
    }
    const { items } = buildNotificationList(
      sources,
      seenMarker,
      ['news'],
      new Set(['news:1']),
      2
    )
    expect(items.map((i) => i.id)).toEqual(['2', '3'])
  })

  it('drops a clicked item that is still new', () => {
    const sources = {
      news: {
        items: [
          { id: '1', title: 'one', url: 'u1', at: at('10') },
          { id: '2', title: 'two', url: 'u2', at: at('09') },
        ],
      },
    }
    const { items } = buildNotificationList(sources, marker, ['news'], new Set(['news:1']))
    expect(items.every((i) => i.id !== '1')).toBe(true)
    expect(items.map((i) => i.isNew)).toEqual([true])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/notification-list.test.ts`
Expected: FAIL — "drops a clicked item" gets `['1','2']` instead of `['2']`.

- [ ] **Step 3: Implement**

In `src/lib/notification-list.ts`, change the signature and add the filter. Keep the existing docstring above the function and add the paragraph shown.

```ts
export function buildNotificationList(
  sources: NotificationsResponse['sources'],
  lastSeen: LastSeen,
  enabled: NotificationSource[],
  clicked: ReadonlySet<string> = new Set(),
  cap: number = LIST_CAP
): NotificationListResult {
```

Inside the per-item loop, replace:

```ts
    for (const item of group.items) {
      const display: DisplayItem = { ...item, source, isNew: isItemNew(item, lastSeen[source]) }
      ;(display.isNew ? fresh : seen).push(display)
    }
```

with:

```ts
    for (const item of group.items) {
      // Filtered BEFORE the partition, not after: dropping a seen item here
      // frees a slot that seen.slice() then fills from the next item down.
      // Filtering the finished list instead would leave a hole.
      if (clicked.has(`${source}:${item.id}`)) continue
      const display: DisplayItem = { ...item, source, isNew: isItemNew(item, lastSeen[source]) }
      ;(display.isNew ? fresh : seen).push(display)
    }
```

Note `cap` moved after `clicked`. Check every existing call site and test that passes a cap positionally and fix it — `grep -rn "buildNotificationList" src tests`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including every pre-existing `notification-list` test.

- [ ] **Step 5: Verify the full gate, then commit**

```bash
npm test && npm run typecheck && npm run build
git add src/lib/notification-list.ts tests/notification-list.test.ts
git commit -m "feat(notifications): filter clicked items out of the list"
```

**Report:** commit hash + 2 bullets.

---

### Task 4: Choose the default tab

**Files:**
- Modify: `src/lib/notification-list.ts`
- Test: `tests/notification-list.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type PopupTab = 'launcher' | 'notifs'`, `selectDefaultTab(newCount: number, enabledCount: number): PopupTab`.

- [ ] **Step 1: Write the failing tests**

Add `selectDefaultTab` to the import block. Append:

```ts
describe('selectDefaultTab', () => {
  it('opens on the notifications tab when something is new', () => {
    expect(selectDefaultTab(1, 3)).toBe('notifs')
    expect(selectDefaultTab(50, 1)).toBe('notifs')
  })

  it('opens on the launcher when nothing is new', () => {
    expect(selectDefaultTab(0, 3)).toBe('launcher')
  })

  // Every source switched off means there is no tab strip at all, so the
  // launcher is the whole popup regardless of a stale count.
  it('opens on the launcher when every source is disabled', () => {
    expect(selectDefaultTab(5, 0)).toBe('launcher')
    expect(selectDefaultTab(0, 0)).toBe('launcher')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/notification-list.test.ts`
Expected: FAIL — `selectDefaultTab is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/notification-list.ts`:

```ts
export type PopupTab = 'launcher' | 'notifs'

/**
 * Which tab the popup opens on.
 *
 * Reads the cached badge count rather than the built list, deliberately: it is
 * the number the toolbar icon is showing, so the tab and the icon tell one
 * story. `enabledCount` of zero means every source is switched off, in which
 * case there is no tab strip and the launcher is the whole popup.
 */
export function selectDefaultTab(newCount: number, enabledCount: number): PopupTab {
  if (enabledCount === 0) return 'launcher'
  return newCount > 0 ? 'notifs' : 'launcher'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify the full gate, then commit**

```bash
npm test && npm run typecheck && npm run build
git add src/lib/notification-list.ts tests/notification-list.test.ts
git commit -m "feat(popup): choose the opening tab from the cached count"
```

**Report:** commit hash + 2 bullets.

---

### Task 5: Prove the tests can fail

No production change. This task exists because a green suite proves nothing until you have watched it go red for the right reason.

- [ ] **Step 1: Run each mutation, record the result, revert it**

For each row: make the edit, run the command, confirm the named test FAILS, then `git checkout -- <file>` before the next row.

| # | Mutation | File | Must go red |
|---|---|---|---|
| 1 | Delete the `if (clicked.has(...)) continue` line | `notification-list.ts` | "drops a clicked item" |
| 2 | Change the key to `` `${item.id}` `` | `notification-list.ts` | "does not hide a same-id item in another source" |
| 3 | Move the filter after the partition: restore the original loop, then `items: [...fresh, ...seen.slice(...)].filter((i) => !clicked.has(\`${i.source}:${i.id}\`))` | `notification-list.ts` | "backfills when a clicked item is removed from the seen half" |
| 4 | Change `newCount > 0` to `newCount > 1` | `notification-list.ts` | "opens on the notifications tab when something is new" |
| 5 | Make `pruneClicked` return immediately | `notifications-store.ts` | "drops a key whose item is gone…" |
| 6 | Delete `\|\| group.unavailable` from the prune's skip condition | `notifications-store.ts` | "keeps every key of a source flagged unavailable" |

Run: `npm test` after each edit.

**If any mutation leaves the suite GREEN, stop and report it.** That test is decoration and the finding matters more than finishing the slice.

- [ ] **Step 2: Confirm the tree is clean and everything passes**

```bash
git status --porcelain     # must print nothing
npm test && npm run typecheck && npm run build
```

- [ ] **Step 3: Commit the record**

```bash
git commit --allow-empty -m "test: mutation checks for slice 1

All six mutations confirmed red against the named test, then reverted:
1 clicked filter removed, 2 bare-id key, 3 filter after partition,
4 default-tab comparison, 5 prune no-op, 6 prune ignores unavailable."
```

**Report:** commit hash + which mutations went red + any that did not.

---

# SLICE 2 — the tab strip

A new self-contained DOM module plus the markup and styles it drives. `popup.ts` is NOT touched in this slice. Four commits.

### Task 6: The tab strip module

**Files:**
- Create: `src/popup/tab-strip.ts`
- Create: `tests/tab-strip.test.ts`

**Interfaces:**
- Consumes: `type PopupTab` from `@/lib/notification-list` (Task 4).
- Produces: `mountTabStrip(el: TabStripElements, opts?: TabStripOptions): TabStrip`, where `TabStrip` is `{ show(tab: PopupTab): void; current(): PopupTab }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/tab-strip.test.ts`. **No environment pragma is needed** — `vitest.config.ts` already sets `environment: 'jsdom'` globally, so every test in this repo has had DOM globals all along. Do not add or edit a vitest config.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountTabStrip } from '@/popup/tab-strip'

function fixture() {
  document.body.innerHTML = `
    <div id="tabs">
      <button id="lb" role="tab" aria-controls="lp" aria-selected="true">Launcher</button>
      <button id="nb" role="tab" aria-controls="np" aria-selected="false">New for you</button>
    </div>
    <div id="lp">launcher panel</div>
    <div id="np" hidden>notifs panel</div>`
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  return {
    strip: $('tabs'),
    launcherBtn: $<HTMLButtonElement>('lb'),
    notifsBtn: $<HTMLButtonElement>('nb'),
    launcherPanel: $('lp'),
    notifsPanel: $('np'),
  }
}

beforeEach(() => { document.body.innerHTML = '' })

describe('tab strip', () => {
  it('shows one panel and hides the other', () => {
    const el = fixture()
    const strip = mountTabStrip(el)
    strip.show('notifs')
    expect(el.notifsPanel.hidden).toBe(false)
    expect(el.launcherPanel.hidden).toBe(true)
    expect(strip.current()).toBe('notifs')

    strip.show('launcher')
    expect(el.launcherPanel.hidden).toBe(false)
    expect(el.notifsPanel.hidden).toBe(true)
  })

  it('keeps aria-selected and roving tabindex in step', () => {
    const el = fixture()
    mountTabStrip(el).show('notifs')
    expect(el.notifsBtn.getAttribute('aria-selected')).toBe('true')
    expect(el.launcherBtn.getAttribute('aria-selected')).toBe('false')
    expect(el.notifsBtn.tabIndex).toBe(0)
    expect(el.launcherBtn.tabIndex).toBe(-1)
  })

  it('switches on click', () => {
    const el = fixture()
    mountTabStrip(el)
    el.notifsBtn.click()
    expect(el.notifsPanel.hidden).toBe(false)
  })

  // Automatic activation: with two tabs, arriving IS choosing.
  it('activates and focuses on arrow keys', () => {
    const el = fixture()
    mountTabStrip(el)
    el.launcherBtn.focus()
    el.launcherBtn.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    )
    expect(el.notifsPanel.hidden).toBe(false)
    expect(document.activeElement).toBe(el.notifsBtn)

    el.notifsBtn.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
    )
    expect(el.launcherPanel.hidden).toBe(false)
    expect(document.activeElement).toBe(el.launcherBtn)
  })

  it('calls onShow every time a tab is shown', () => {
    const el = fixture()
    const onShow = vi.fn()
    const strip = mountTabStrip(el, { onShow })
    strip.show('notifs')
    strip.show('launcher')
    strip.show('notifs')
    expect(onShow.mock.calls.map((c) => c[0])).toEqual(['notifs', 'launcher', 'notifs'])
  })

  /**
   * Decision 3 of the spec, asserted at this module's boundary.
   *
   * The gold "new" dots are computed once, at render, from a marker that has
   * already advanced by the time a tab can be clicked. If switching tabs
   * re-rendered the panel, every dot would vanish mid-visit. This module must
   * therefore never write panel content — only visibility.
   */
  it('never touches panel content', () => {
    const el = fixture()
    el.notifsPanel.innerHTML = '<a class="n-row is-new">a sim</a>'
    const before = el.notifsPanel.innerHTML
    const strip = mountTabStrip(el)
    strip.show('notifs')
    strip.show('launcher')
    strip.show('notifs')
    el.notifsBtn.click()
    expect(el.notifsPanel.innerHTML).toBe(before)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/tab-strip.test.ts`
Expected: FAIL — cannot resolve `@/popup/tab-strip`.

- [ ] **Step 3: Implement**

Create `src/popup/tab-strip.ts`:

```ts
import type { PopupTab } from '@/lib/notification-list'

export interface TabStripElements {
  strip: HTMLElement
  launcherBtn: HTMLButtonElement
  notifsBtn: HTMLButtonElement
  launcherPanel: HTMLElement
  notifsPanel: HTMLElement
}

export interface TabStripOptions {
  /** Called every time a tab is shown, including the initial show. */
  onShow?: (tab: PopupTab) => void
}

export interface TabStrip {
  show(tab: PopupTab): void
  current(): PopupTab
}

/**
 * Owns the tab strip: which panel is visible, ARIA state, and keyboard moves.
 *
 * It deliberately does NOT know how to render either panel. Switching tabs
 * must never re-render the notification list — the gold "new" dots are
 * computed once from a marker that has already advanced, so a re-render would
 * clear them mid-visit. Visibility only.
 */
export function mountTabStrip(el: TabStripElements, opts: TabStripOptions = {}): TabStrip {
  let current: PopupTab = 'launcher'

  function show(tab: PopupTab): void {
    current = tab
    const onNotifs = tab === 'notifs'

    el.notifsPanel.hidden = !onNotifs
    el.launcherPanel.hidden = onNotifs

    for (const [btn, active] of [
      [el.launcherBtn, !onNotifs],
      [el.notifsBtn, onNotifs],
    ] as const) {
      btn.setAttribute('aria-selected', String(active))
      // Roving tabindex: one Tab press moves into the panel rather than
      // walking across the other tab button.
      btn.tabIndex = active ? 0 : -1
    }

    opts.onShow?.(tab)
  }

  el.launcherBtn.addEventListener('click', () => show('launcher'))
  el.notifsBtn.addEventListener('click', () => show('notifs'))

  el.strip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    // Two tabs, so either arrow means "the other one". Automatic activation:
    // arriving is choosing.
    const next: PopupTab = current === 'launcher' ? 'notifs' : 'launcher'
    show(next)
    ;(next === 'notifs' ? el.notifsBtn : el.launcherBtn).focus()
  })

  return { show, current: () => current }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck && npm run build
git add src/popup/tab-strip.ts tests/tab-strip.test.ts
git commit -m "feat(popup): a tab strip that switches panels without re-rendering"
```

**Report:** commit hash + 2 bullets.

---

### Task 7: Markup

**Files:**
- Modify: `src/popup/popup.html`

**Interfaces:**
- Consumes: nothing.
- Produces: element ids `tabs`, `tab-launcher-btn`, `tab-notifs-btn`, `tab-count`, `tab-launcher`, `tab-notifs`. `notiflist` keeps its id and moves inside `#tab-notifs`.

- [ ] **Step 1: Replace the launcher body**

Replace the whole `<div id="launcher">…</div>` block with:

```html
<div id="launcher">
  <div id="tabs" class="tabs" role="tablist" aria-label="Popup sections" hidden>
    <button id="tab-launcher-btn" class="tab" type="button" role="tab"
            aria-controls="tab-launcher" aria-selected="true">Launcher</button>
    <button id="tab-notifs-btn" class="tab" type="button" role="tab"
            aria-controls="tab-notifs" aria-selected="false" tabindex="-1">New for you<span
            id="tab-count" class="tab-count" hidden></span></button>
  </div>

  <div id="tab-launcher" role="tabpanel" aria-labelledby="tab-launcher-btn">
    <nav id="grid" class="grid" aria-label="Quick launch"></nav>
    <section id="mystuff" class="sec" hidden><span class="lbl">My stuff</span><div id="mychips" class="chips"></div></section>
    <section id="pins" class="sec"><span class="lbl">Pinned</span><div id="pinchips" class="chips"></div></section>
    <section id="staff" class="sec staff" hidden><span class="lbl">Staff</span><div id="staffgrid" class="chips"></div></section>
    <section id="feedback" class="sec"><div class="chips"><button id="report-issue" type="button" class="chip">🐞 Report an issue on this page</button></div></section>
  </div>

  <div id="tab-notifs" role="tabpanel" aria-labelledby="tab-notifs-btn" hidden>
    <div id="notiflist" class="notiflist"></div>
  </div>
</div>
```

The old `<section id="notifs">` wrapper and its `<span class="lbl">New for you</span>` are deleted — the tab is the label now. Every other id is unchanged, which is why `popup.ts` still builds in this slice.

- [ ] **Step 2: Confirm nothing broke**

```bash
npm test && npm run typecheck && npm run build
```

Expected: PASS. `popup.ts` still references `#notifs` — that is fine for now; it resolves to `null` only at runtime, and Task 9 removes it.

- [ ] **Step 3: Commit**

```bash
git add src/popup/popup.html
git commit -m "feat(popup): tab strip and two panels in the markup"
```

**Report:** commit hash + 2 bullets.

---

### Task 8: Styles

**Files:**
- Modify: `src/popup/popup.css`

- [ ] **Step 1: Add the tab styles**

Insert immediately before the `/* sections */` comment block:

```css
/* Tabs. One line of text, no icons — the strip costs vertical space on every
   open including quiet ones, so it stays as short as it can be. */
.tabs{display:flex;gap:4px;padding:8px 14px 0}
.tab{flex:1 1 auto;background:#141c38;border:1px solid #232d55;border-bottom:0;
  border-radius:8px 8px 0 0;color:var(--muted);font:inherit;font-size:12px;font-weight:600;
  padding:7px 10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
  gap:6px}
.tab:hover{color:var(--ink)}
.tab[aria-selected="true"]{background:var(--tile);color:var(--ink);
  box-shadow:inset 0 2px 0 0 var(--gold)}
.tab:focus-visible{outline:2px solid var(--staff-accent);outline-offset:-2px}
.tab-count{background:var(--gold);color:#1a1200;border-radius:999px;font-size:10px;
  font-weight:700;line-height:1;padding:2px 5px;min-width:15px;text-align:center}
```

- [ ] **Step 2: Confirm the build**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/popup/popup.css
git commit -m "style(popup): tab strip and count pill"
```

**Report:** commit hash + 2 bullets.

---

# SLICE 3 — wiring the popup

Connects slices 1 and 2. Five commits. No new library code.

### Task 9: Render into the panel and prune

**Files:**
- Modify: `src/popup/popup.ts:426-462` (`renderNotifications`)

**Interfaces:**
- Consumes: `getClicked`, `pruneClicked` (Tasks 1-2), `buildNotificationList` with the `clicked` parameter (Task 3).
- Produces: a module-level `rendered` snapshot `{ cached, lastSeen, enabled } | null` that Task 10 reads.

- [ ] **Step 1: Extend the imports**

```ts
import {
  getCachedCount,
  getCachedItems,
  getClicked,
  getLastSeen,
  pruneClicked,
  setLastSeen,
} from '@/lib/notifications-store'
import {
  buildNotificationList,
  selectDefaultTab,
  type DisplayItem,
  type PopupTab,
} from '@/lib/notification-list'
import { mountTabStrip, type TabStrip } from '@/popup/tab-strip'
```

`getCachedCount`, `selectDefaultTab`, `PopupTab`, `mountTabStrip` and `TabStrip` are used in Task 10; adding them now keeps the import block edited once.

- [ ] **Step 2: Add the snapshot and rewrite the render**

Above `renderNotifications`, add:

```ts
/**
 * The exact payload the panel rendered, held for showNotifs().
 *
 * The marker must advance against THIS snapshot, never a fresh storage read —
 * a worker poll landing between the render and the member clicking the tab
 * would otherwise mark an item seen that was never on screen. Same reasoning
 * that moved this write out of the worker in Phase 3.1.
 */
let rendered: {
  cached: NotificationsResponse['sources']
  lastSeen: LastSeen
  enabled: NotificationSource[]
} | null = null
```

and add to the type import at the top:

```ts
import {
  SOURCE_LABELS as NOTIF_SOURCE_LABELS,
  type LastSeen,
  type NotificationSource,
  type NotificationsResponse,
} from '@/lib/notifications-types'
```

Replace the body of `renderNotifications` with:

```ts
async function renderNotifications(): Promise<void> {
  const box = document.getElementById('notiflist')!
  box.innerHTML = ''

  const [cached, prefs, clicked] = await Promise.all([getCachedItems(), getPrefs(), getClicked()])
  const enabled = enabledSources(prefs)
  if (!enabled.length) return

  if (cached === null) {
    box.appendChild(notifNote('Checking for updates…'))
    void browser.runtime.sendMessage({ type: 'notif:refresh' }).catch(() => {})
    return
  }

  const lastSeen = await getLastSeen()
  const { items, state } = buildNotificationList(cached, lastSeen, enabled, new Set(clicked))

  if (state === 'disabled') return
  if (state === 'outage') {
    box.appendChild(notifNote('Couldn’t reach HQ — this list may be out of date.'))
    return
  }
  if (!items.length) {
    box.appendChild(notifNote('Nothing new right now.'))
  } else {
    for (const item of items) box.appendChild(buildNotifRow(item))
  }

  // Only what was actually rendered, and only now.
  rendered = { cached, lastSeen, enabled }

  // Keys whose item has aged out of a HEALTHY source can go; a sick source
  // keeps everything it has.
  void pruneClicked(cached).catch(() => {})
}
```

Note what left: the `section` lookup and every `section.hidden` line (the tab strip owns visibility now), and the `setLastSeen(...)` / `notif:refresh` pair at the end (Task 10 owns them).

- [ ] **Step 3: Verify**

```bash
npm test && npm run typecheck && npm run build
```

Expected: PASS. Nothing shows the notifications yet — Task 10 mounts the strip.

- [ ] **Step 4: Commit**

```bash
git add src/popup/popup.ts
git commit -m "refactor(popup): render notifications into the panel and prune clicked keys"
```

**Report:** commit hash + 2 bullets.

---

### Task 10: Mount the strip and move the marker

**Files:**
- Modify: `src/popup/popup.ts` (the `DOMContentLoaded` handler and a new `showNotifs`)

**Interfaces:**
- Consumes: `rendered` (Task 9), `mountTabStrip` (Task 6), `selectDefaultTab` (Task 4), the ids from Task 7.
- Produces: nothing later tasks read.

- [ ] **Step 1: Add the mount and the marker write**

Add above the `DOMContentLoaded` handler:

```ts
let tabs: TabStrip | null = null

/**
 * Advance the marker because the panel is now on screen.
 *
 * "Seen" means visible, not rendered — the panel renders on every open,
 * including opens that land on Launcher, and clearing the badge for someone
 * who never looked loses information silently.
 *
 * The write is AWAITED before notif:refresh: the worker recomputes the badge
 * from stored state, so a refresh racing ahead of the write counts against the
 * old marker and puts the number straight back.
 */
async function markNotifsSeen(): Promise<void> {
  if (!rendered) return
  const { cached, lastSeen, enabled } = rendered
  await setLastSeen(advanceLastSeen(lastSeen, cached, enabled))
  void browser.runtime.sendMessage({ type: 'notif:refresh' }).catch(() => {
    // The worker may be asleep; the next alarm reconciles the badge.
  })
}

async function mountTabs(): Promise<void> {
  const [prefs, count] = await Promise.all([getPrefs(), getCachedCount()])
  const enabled = enabledSources(prefs)

  // Every source switched off: no strip at all, the launcher is the popup.
  if (!enabled.length) {
    document.getElementById('tab-notifs')!.hidden = true
    return
  }

  const strip = document.getElementById('tabs')!
  strip.hidden = false

  const pill = document.getElementById('tab-count')!
  const text = badgeText(count)
  pill.textContent = text
  pill.hidden = !text

  tabs = mountTabStrip(
    {
      strip,
      launcherBtn: document.getElementById('tab-launcher-btn') as HTMLButtonElement,
      notifsBtn: document.getElementById('tab-notifs-btn') as HTMLButtonElement,
      launcherPanel: document.getElementById('tab-launcher')!,
      notifsPanel: document.getElementById('tab-notifs')!,
    },
    { onShow: (tab: PopupTab) => { if (tab === 'notifs') void markNotifsSeen() } }
  )

  tabs.show(selectDefaultTab(count, enabled.length))
}
```

Add `badgeText` to the `notification-count` import:

```ts
import { advanceLastSeen, badgeText } from '@/lib/notification-count'
```

- [ ] **Step 2: Mount after the render resolves**

Replace the `DOMContentLoaded` handler with:

```ts
document.addEventListener('DOMContentLoaded', () => {
  renderGrid(document.getElementById('grid')!, MEMBER_LINKS)
  wireReportIssue()
  wireSearch()
  // The strip mounts only after renderNotifications() has filled the panel and
  // set `rendered` — showing the tab is what advances the marker, so there must
  // be a snapshot to advance against.
  void Promise.all([renderPins(), personalize(), renderNotifications()]).then(mountTabs)
})
```

- [ ] **Step 3: Verify**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 4: Check the count pill against a real number**

Run: `grep -n "badgeText" src/popup/popup.ts src/lib/notification-count.ts`
Expected: the popup imports it; `notification-count.ts` still returns `''` for `0` and `'9+'` above `BADGE_CAP`. Do not change that function.

- [ ] **Step 5: Commit**

```bash
git add src/popup/popup.ts
git commit -m "feat(popup): mount the tab strip and advance the marker on show"
```

**Report:** commit hash + 2 bullets.

---

### Task 11: Await the click write

**Files:**
- Modify: `src/popup/popup.ts` (`buildNotifRow`, around line 400)

**Interfaces:**
- Consumes: `addClicked`, `clickedKey` (Task 1).

- [ ] **Step 1: Add the imports**

Add `addClicked` and `clickedKey` to the `notifications-store` import block.

- [ ] **Step 2: Replace the row's click handler**

In `buildNotifRow`, replace:

```ts
  a.addEventListener('click', (e) => { e.preventDefault(); openUrl(item.url) })
```

with:

```ts
  // NOT openUrl(): that calls window.close() on the same synchronous turn, and
  // addClicked is a read-modify-write whose set() is only issued after its
  // get() resolves — by which point this context is gone and the write is
  // dropped. Tab first so the member sees no delay, then the write, awaited,
  // then close.
  a.addEventListener('click', async (e) => {
    e.preventDefault()
    browser.tabs.create({ url: item.url })
    await addClicked(clickedKey(item.source, item.id)).catch(() => {})
    window.close()
  })
```

- [ ] **Step 3: Verify**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 4: Confirm openUrl is still used elsewhere and unchanged**

Run: `grep -n "openUrl" src/popup/popup.ts`
Expected: still defined and still used by the grid, chips, staff links, sign-in link and Report-an-issue. Only the notification row stops using it.

- [ ] **Step 5: Commit**

```bash
git add src/popup/popup.ts
git commit -m "fix(popup): await the clicked write before the popup closes"
```

**Report:** commit hash + 2 bullets.

---

### Task 12: Prove the wiring, by breaking it

- [ ] **Step 1: Two mutations, confirmed red**

| # | Mutation | File | Must go red |
|---|---|---|---|
| 1 | Make `mountTabStrip`'s `show()` write `el.notifsPanel.innerHTML = ''` before toggling | `tab-strip.ts` | "never touches panel content" |
| 2 | Change `onShow` to fire only for `'launcher'` | `tab-strip.ts` | "calls onShow every time a tab is shown" |

Run `npm test` after each, then `git checkout -- src/popup/tab-strip.ts`.

- [ ] **Step 2: Confirm a clean tree and a green gate**

```bash
git status --porcelain     # must print nothing
npm test && npm run typecheck && npm run build
```

- [ ] **Step 3: Report and stop**

```bash
git log --oneline -12
```

**Report the full log, then STOP.** Do not open a pull request, do not merge, do not push to `main`. Claude runs the manual browser checks and handles the release.

---

## Manual verification — Claude, not Codex

Run after slice 3, in Chrome and Firefox, against `npm run build` output:

1. Items new → opens on New for you, toolbar badge clears.
2. Nothing new → opens on Launcher, Pinned visible without scrolling.
3. **The marker gate.** Temporarily `return 'launcher'` from `selectDefaultTab`, reload, open with items new, close without touching the strip — the badge is still there. Revert.
4. Switch tabs twice — gold dots stay lit, count pill unchanged.
5. Click a row, reopen — the row is gone, an older item took its place. Then add a 2s delay before `addClicked`'s `set` and confirm the popup hangs open; remove the `await` and confirm the row comes back. Restore both.
6. All sources off in options → no tab strip.
7. Keyboard: Tab to the strip, ArrowRight activates and focuses New for you; one more Tab enters the panel.

## Release — Claude

Version bump to `0.4.0` in `package.json` and both manifests, release notes (including the line about the badge now persisting until you look at the list — settled with Jordan), zips via `npm run package`, GitHub release, then the forum replies to Jalana and Isara on topic 4180. **The replies go out only after the release is live-verified.**

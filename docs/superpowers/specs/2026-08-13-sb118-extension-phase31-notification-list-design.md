# Phase 3.1 — list the notifications, don't just count them

_Design spec. 2026-08-13._

## Why

Phase 3 shipped a badge that counts new announcements, sims and news, and a popup that
does not say what any of them are. Lhandon Nilsen put it plainly in staff Discourse topic
4180, post #7, with a hand-drawn mockup:

> I did notice that there was a notification number, just like on an app, but when I
> clicked it, it didn't show me where that was.

That gap was a deliberate scope line in Phase 3 — no UI was invented past the spec — and it
has been documented as a known gap in `STAFF-TEST.md`, the release notes and the forum
announcement ever since. It is now the most-requested thing in the staff test round.

**This phase closes it and nothing else.** No new sources, no notification history, no
cross-browser sync of read state.

## What already exists

Established by reading the live code, not assumed:

- **`GET /api/me/notifications?limit=20`** already returns everything needed:
  `sources.{announcements,sims,news}` → `{ items: [{ id, title, url, at }], unavailable?: boolean }`.
  **No HQ change is required for this phase.**
- **Only the background worker fetches it.** `refreshBadge()` fetches, counts, writes an
  integer to `notifCount`, sets the badge, and throws the items away.
- **The popup reads that integer** (`getCachedCount()`) and fires `notif:seen` on
  `DOMContentLoaded`, which advances one ISO marker per source in `notifLastSeen`.
- **`countNewForSource()`** treats a missing *or unparseable* marker as "count everything",
  deliberately — a corrupt marker used to pin a source at zero while looking calm.
- **Per-source toggles** already narrow the request via `enabledSources(prefs)`.

## Decisions

Four questions were settled with Jordan before this was written.

### 1. New stays marked for the visit that revealed it

The conflict: the popup marks everything seen the instant it opens. That was harmless when
the badge was only a number — nothing was on screen to lose. The moment items are listed,
it means **the "3" you clicked is already cleared by the time you look at the list.**

**Resolved:** the popup computes the new-set from `notifLastSeen` **before** it advances the
marker, and holds that set in a module-level variable for the lifetime of that popup. The
marker then advances as it does today. Dots stay lit for the visit that revealed them and
are gone next time.

**This needs no new storage.** An earlier sketch proposed a second "pending seen" marker;
it is not necessary, because the popup lives for a single viewing and the rendered set is
captured before the marker moves. Holding the set in memory rather than recomputing it also
means a re-render inside the same popup (which the pins section already does) cannot make
the dots vanish mid-visit.

**`markAllSeen()` is deleted, and the popup advances the marker itself.**

Today `markAllSeen()` lives in the worker, fetches a fresh payload, and advances the markers
to *its* newest timestamps. Once the popup renders a cache those are two different payloads:
an item arriving between the worker's last poll and the popup opening would be marked seen
without ever having been shown, and would never be dotted again.

Moving the fetch out is not enough. A worker that reads `notifItems` when the message
arrives is still reading it *later* than the popup rendered it, and the message carries
nothing that identifies which snapshot was on screen — a poll landing in between puts the
worker back on a payload the member never saw. Passing timestamps in the message would fix
it, but only by shipping the snapshot through an extra hop.

**The popup already holds the exact snapshot it rendered, and can already write storage.**
So it computes `advanceLastSeen(current, renderedSources, enabled)` from that snapshot and
calls `setLastSeen()` directly, immediately after rendering. There is no race left to lose,
because there is no second read.

It then sends **`notif:refresh`**, which the worker already implements: re-poll, re-count
against the marker the popup just wrote, update the badge. If something genuinely new
arrived in the meantime, the badge correctly shows it rather than being forced to zero.

`markAllSeen()` and the `notif:seen` message are removed entirely. One message type, one
writer per piece of state, and a deletion rather than an addition.

**The trade, stated plainly:** a member who opens the popup and does not read the items
loses the marks anyway. That is inherent to "opening is reading" and is what the alternative
— per-source Mark read buttons — was rejected for. It puts three headings between the member
and the launcher.

### 2. The popup renders the worker's cached payload; it never fetches

`refreshBadge()` stores the payload it already has under `notifItems`. The popup reads it.

- One fetch path, not two. No second place to get the 401, timeout and abort handling wrong.
- No loading state on open — the list is there immediately.
- **The list cannot disagree with the badge**, because it is the same data that produced the
  count. A fresh popup-side fetch could show four items under a badge that said three.

The cost is up to 15 minutes of staleness, which is exactly the staleness the badge already
has. Nothing is made worse.

### 3. The section is always present

The list renders whether or not anything is new; the dots are the only thing that changes.
Hiding it when everything has been read would make the feature disappear at the moment
someone goes looking for it — and it is the thing Lhandon can point at and say "that is
what the number meant."

### 4. It sits below the quick-launch grid, above Pinned

The extension is a launcher that also reports what is new, not a notification app. Most
opens are "take me to HQ". Putting the list first would push the grid down and, on a busy
week, push the pins past the bottom of a 600px popup. Below the grid it is still visible
without scrolling.

**The first-run explainer is deleted** (`renderNotificationIntro()`, the `#notif-intro`
element, its CSS, and the `notifIntroDismissed` pref). It exists to explain a bare number.
Once the items are on screen the paragraph and its Dismiss button stop earning their space.

**There is no "Mark all read" control.** Opening the popup already marks everything read, so
the button would do what just happened.

## Architecture

```
background.ts            popup.ts
  refreshBadge()           renderNotifications()
    fetch  ──────┐           │  reads notifItems + notifLastSeen + prefs
    countNew()   │           │  buildNotificationList()  ← pure
    setBadge()   │           │  render rows, dots from the captured set
    setCachedItems(payload)  │  setLastSeen(from that snapshot), then notif:refresh
                 │           ▼
          storage.local: notifItems, notifCount, notifLastSeen
```

### New module — `src/lib/notification-list.ts`

Pure, no I/O, no DOM. The testable core.

```ts
export interface DisplayItem {
  id: string
  title: string
  url: string
  at: string
  source: NotificationSource
  isNew: boolean
}

export type NotificationListState =
  | 'ok'        // render the items (possibly an empty, quiet list)
  | 'outage'    // every enabled source failed
  | 'disabled'  // the member switched every source off

export interface NotificationListResult {
  items: DisplayItem[]
  state: NotificationListState
}

export function buildNotificationList(
  sources: NotificationsResponse['sources'],
  lastSeen: LastSeen,
  enabled: NotificationSource[],
  cap?: number
): NotificationListResult
```

Rules, in order:

1. Consider only sources in `enabled`.
2. Skip any source flagged `unavailable`. **Never render it as an empty group** — the same
   rule the search groups follow, for the same reason: an outage that reads as "nothing
   here" is worse than an outage that says so.
3. Flag `isNew` per item using the **same** comparison `countNewForSource()` uses, including
   its missing/unparseable-marker behaviour. The list and the badge must never disagree
   about what "new" means; both call one shared predicate rather than two copies of the
   logic that can drift.
4. **Partition into new and old, then sort each by `at` descending, then concatenate —
   new first.** An item with an unparseable `at` sorts last within its own group rather than
   being dropped; it is still a real thing that happened.
5. **Keep every new item. Fill the remaining slots, up to `cap` (default 8), with the newest
   old ones.** The rendered length is `newCount + max(0, cap - newCount)`.

   **This must be a partition, not a sort-then-slice.** Markers are per source, so "new" is
   not a function of absolute time across the whole list: if the sims marker is an hour old
   and the news marker is three days old, a *read* sim from five hours ago sorts above an
   *unread* news item from two days ago. A single time-sorted `slice` would therefore drop
   unread items to make room for read ones — the exact failure this phase exists to prevent.
   Partitioning first also means new items always appear at the top of the section, which is
   what the member expects after clicking a badge.

6. `state` is:
   - `'disabled'` when `enabled` is empty — the member turned every source off, so the
     section is hidden entirely. There is no outage and nothing to say.
   - `'outage'` when at least one source is enabled, every enabled source was skipped as
     unavailable, and no items survived.
   - `'ok'` otherwise, including the ordinary quiet case of zero items.

   Ordering these explicitly matters: an emptiness check written before the disabled check
   would report an outage to someone who simply switched everything off.

### Store — `src/lib/notifications-store.ts`

Adds `getCachedItems()` / `setCachedItems()` for key `notifItems`, validated on read with
the same shape guard `notifications-client.ts` already uses.

**`getCachedItems()` returns `null` for absent, unparseable, or shape-invalid data, and a
payload object otherwise — including an empty one.** The distinction is load-bearing:
`null` means "we have not successfully looked", which is the Checking state, and an empty
payload means "we looked and there was nothing", which is Quiet. Collapsing corrupt data
into an empty payload would tell a member "nothing new" on the strength of a cache we could
not read. A corrupt cache is therefore treated exactly like an absent one — show Checking
and refresh, which also repairs it.

### Worker — `src/background.ts`

`refreshBadge()` calls `setCachedItems(res.sources)` alongside `setCachedCount(total)`.
Unchanged: a `null` response still leaves the existing badge **and now the existing cache**
alone, so a transient HQ failure cannot blank a list the member could otherwise still read.

### Popup — `src/popup/popup.ts`

`renderNotifications()` runs on `DOMContentLoaded` and advances the marker only after the
rows are in the DOM. Each row is
an `<a>` built through the existing `renderLink` pattern: opens via `openUrl()` in a new
tab, closes the popup. Row contents: a dot (empty span when not new, so rows stay aligned),
the title, and a muted line with the source label and a relative time.

**The section heading is "New for you".** It is the same heading whether or not anything is
new, matching decision 3 — the heading is the section's name, not a status.

**Titles are truncated in CSS, never in storage or in the builder**, with the full text on
the row's `title` attribute. This is the rule the pin chips already follow, established when
a page title swamped a chip in feedback round 1: two lines maximum via `-webkit-line-clamp`,
so a long sim subject wraps once and then ellipses rather than pushing the launcher down.

Relative time is formatted with `Intl.RelativeTimeFormat` — already available, no
dependency, and correct in the member's locale. **An `at` that will not parse renders the
source label alone, with no time**, rather than being passed to the formatter, which would
produce "NaN days ago" or throw inside the render. The item is still listed and still
clickable; only its timestamp is missing, because only its timestamp is broken.

### The five states, and exactly what each says

Defined here so the implementation and the end-to-end assertions cannot drift apart:

| State | Condition | Popup shows |
|---|---|---|
| Items | `getCachedItems()` non-null, `state: 'ok'`, one or more items | The list |
| Quiet | `getCachedItems()` non-null, `state: 'ok'`, zero items | Section present, one muted line: **"Nothing new right now."** |
| Checking | `getCachedItems()` returns `null` — absent or corrupt cache | **"Checking for updates…"**, and fire `notif:refresh` |
| Outage | `state: 'outage'` | **"Couldn't reach HQ — this list may be out of date."** |
| Off | `state: 'disabled'` | Section hidden entirely |

Checking is deliberately distinct from Quiet: a null cache means we have not successfully
looked, and "nothing new" would be a claim we have not earned. Note the two are told apart
by the **getter's return value**, not by the length of the item list — a present, healthy,
empty payload is Quiet, not Checking.

**Checking does not resolve inside the open popup.** `notif:refresh` primes the cache for
the next opening; it does not re-render a popup that is already on screen. Re-rendering
mid-view would also mean advancing the marker a second time against a payload the member
may not have looked at. A fresh install therefore shows Checking once and the real list on
the following open, and Phase 3 already has this shape — the badge behaves the same way.

## Testing

**Unit — `tests/notification-list.test.ts`:**

- merge across three sources sorts newest first
- the `isNew` boundary: an item exactly at the marker is not new; one millisecond after is
- a missing marker flags every item in that source new (matching `countNewForSource`)
- an unparseable marker does the same, rather than flagging none
- an unavailable source contributes nothing and does not appear as an empty group
- the cap holds at 8 with 20 old items
- the cap is exceeded rather than dropping a new item: 12 new items all render
- **the partition case, which a sort-then-slice would fail:** sims marker one hour old, news
  marker three days old, so a read five-hour-old sim is chronologically above an unread
  two-day-old news item — with the cap filled by read sims, the unread news item must still
  render, and must render above them
- a disabled source is excluded even when the payload contains it
- `state` is `'outage'` only when every enabled source failed and nothing survived
- `state` is `'disabled'` when no sources are enabled, even if the payload is full and every
  source is flagged unavailable — the disabled check comes first
- an item with an unparseable `at` sorts last within its group and is not dropped

**Unit — `tests/notifications-store.test.ts`** (added to the existing file):

- a stored payload with valid but empty sources round-trips as an empty payload, **not**
  `null` — the Quiet-versus-Checking distinction lives or dies on this
- a malformed stored value (a string, an array, a payload whose items lack `url`) returns
  `null`
- an absent key returns `null`

**End-to-end — Playwright against the built extension** (the same harness used to verify
the v0.2.2 add-link work; it loads `dist/chromium` in a persistent context):

- seed `notifItems` and a `notifLastSeen` marker, open the popup, assert exactly the
  expected rows carry dots and the order is newest-first
- assert the dots survive a pins re-render inside the same popup
- assert a row's click target is the item's real `url`
- assert an item with a broken `at` renders its title and source with no time, not "NaN"
- **no cache key at all** → the Checking line, not a blank section
- **a corrupt cache value** (a string where the payload belongs) → also Checking, proving
  corrupt is treated as absent rather than as empty
- **a present but empty payload** → the Quiet line, proving Quiet and Checking are told
  apart by the getter's return value and not by item count
- seed all-unavailable and assert the outage line
- switch every source off and assert the section is absent, not an outage
- **assert the marker is advanced from the rendered snapshot:** open the popup against a
  seeded cache, then write a newer item into `notifItems` while it is open, close and
  reopen, and confirm that newer item is dotted — it was never displayed, so it must not
  have been marked seen

Unit tests that mock the thing under test are what let the Phase 3 sims bug ship — every
test mocked `listShipSims`, so the source returned empty for every member and nothing
caught it. `buildNotificationList` is pure precisely so it can be tested with real data
instead of mocks.

## Out of scope

- **Any HQ change.** The endpoint already returns what is needed.
- **Per-item dismissal.** Read state is one timestamp per source; per-item state is a
  different data model and is not what was asked for.
- **Read state that syncs between browsers.** Still per-browser, unchanged from Phase 3.
- **New sources.** Announcements, sims and news only.
- **Firefox verification.** The standing Firefox smoke test predates this work and is
  tracked in `ROADMAP.md`; it is not a deliverable of this phase.

## Risks

**A member reads the items elsewhere and the dots still show.** Read state is the
extension's own marker, not HQ's. Accepted — it was already true of the badge.

**The cache can be up to 15 minutes old.** Accepted, and identical to the badge's existing
staleness. A member clicking through to a page will see the current version of it.

**`limit=20` per source is a ceiling, not a guarantee.** A very busy week can produce more
new items than the endpoint returns, so the count and the list are both capped by what HQ
sends. Unchanged from Phase 3, worth knowing rather than discovering.

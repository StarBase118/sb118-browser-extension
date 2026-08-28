# Phase 3.2 — give the notifications their own tab, and let a clicked item go away

_Design spec. 2026-08-28._

## Why

Phase 3.1 put the notification list in the popup, directly below the quick-launch grid and
above Pinned. Two staff testers replied within a day of v0.3.0, and both replies are about
the same section.

Jalana Rajel, staff Discourse topic 4180 post #11:

> While I really like the "New for you" section to see what is new.. I do not like the
> placement. If there are a lot of new things I have to scroll a lot to get to the pinned
> tabs and links which means I might just as well scroll through my bookmarks to get there.
> [...] imagine being gone for a day and having like 50 new things

Isara Aleron, post #13:

> If I have any feedback, it would be to remove these items as I click on the link and open
> the relevant page as it is then no longer "new" for me.

**This phase answers both and nothing else.** No new sources, no notification history, no
cross-browser sync of read state, no HQ change.

## What already exists

Established by reading the live code on `main` at `10f0317`, not assumed:

- **`buildNotificationList()`** (`src/lib/notification-list.ts`) partitions the cached payload
  into `fresh` and `seen`, sorts each newest-first, and returns `fresh` followed by `seen`
  trimmed to `LIST_CAP - fresh.length`.
- **`LIST_CAP = 8` only ever trims already-seen items.** The partition is deliberate — the
  docstring explains that slicing a time-sorted list would drop unread items to make room for
  read ones. The consequence nobody wrote down: **`fresh` is uncapped.** Jalana's "50 new
  things" renders 50 rows.
- **`openUrl()` calls `window.close()`** (`src/popup/popup.ts:24-27`). Every notification row
  and every launcher link closes the popup on click.
- **`advanceLastSeen()` runs at the end of `renderNotifications()`** (`popup.ts:459`), against
  the payload just rendered.
- **`renderNotifications()` is called exactly once per popup**, inside the `Promise.all` at
  `popup.ts:534`. It recomputes the new-set from `notifLastSeen` on every call.
- **`badgeText()`** (`src/lib/notification-count.ts`) already caps display at `9+` via
  `BADGE_CAP`.
- **`#results` replaces `#launcher` wholesale** while the search box is non-empty
  (`popup.ts:273-279`).

## Decisions

### 1. Two tabs, not a reorder and not a scroll cap

Jalana offered two options — "make the 'new to you' a new tab within the addon or put it at
the bottom of the whole thing". A third was considered: cap the section's height and let it
scroll internally.

**Moving it to the bottom** is the smallest diff and was rejected. The badge would then point
at something you have to scroll to find, which is most of what Phase 3.1 was for — Lhandon
asked for the number to say what it was about, and burying the answer partly un-asks it.

**Capping the height** bounds the damage but does not remove it: Jalana still scrolls past a
section she did not come for, on every single open, to reach the pins she did come for.

**Tabs cost neither party anything.** The launcher is whole and unpushed; the list is whole
and uncapped. The price is one new concept in a popup that had none, which is the smallest
price of the three.

**This supersedes Phase 3.1 decision 4** ("It sits below the quick-launch grid, above
Pinned"). The reasoning there — "the extension is a launcher that also reports what is new,
not a notification app" — still holds and is exactly why the launcher tab is not the one that
gets displaced.

### 2. The popup opens on the tab that has something to say

Open on **New for you** when the cached badge count is above zero; open on **Launcher**
otherwise.

The alternative — always Launcher, with the count on the tab label — is more predictable and
was rejected anyway. A badge that says 3 and a first screen that does not show the 3 is the
Phase 3.1 complaint in a new costume. On a quiet day, which is most days, Jalana gets her
pins first with no click at all.

**The default reads `getCachedCount()`, not the built list.** These could in principle
disagree, because the badge does not know about clicked items (decision 5). They cannot
disagree in practice: the only way to click an item is from the panel, and showing the panel
advances the marker, which zeroes the badge. Using the same integer the badge shows keeps the
tab and the toolbar icon telling one story.

**The tab choice is not remembered between opens.** A first screen that depends on something
the member did days ago and will not remember doing is worse than one that depends on whether
there is news right now.

### 3. Tab switching toggles visibility; it never re-renders

Both panels render once, at open, inside the existing `Promise.all`. Switching tabs sets
`hidden` and moves focus. Nothing re-reads storage.

**This is load-bearing, not an optimisation.** `renderNotifications()` recomputes `isNew` from
`notifLastSeen` every time it runs, and the marker has already advanced by the time the member
could click a tab. A re-render on switch would therefore clear every gold dot mid-visit —
precisely the failure Phase 3.1 decision 1 exists to prevent, reintroduced through a new door.

### 4. The marker advances when the panel becomes visible, not when it renders

Today, rendering and being seen are the same event, so `advanceLastSeen()` at the end of
`renderNotifications()` is correct. Tabs separate them: the notifications panel renders on
every open, including opens that land on Launcher and never show it.

Left alone, that would clear the badge for a member who never looked — the worst available
bug, because it is silent and it loses information.

**`advanceLastSeen()` moves out of `renderNotifications()` and into `showNotifs()`**, the one
function that makes the panel visible. It runs on open when New for you is the default tab,
and on the click that switches to it. It does not run otherwise. Repeat shows are harmless:
`advanceLastSeen` only ever moves a marker forward.

**Under decision 2 this gate never actually fires, and it belongs there anyway.** Work it
through: the panel is hidden at open only when `selectDefaultTab` returned `launcher`, which
happens only when the cached count is zero, which means no item in the payload is newer than
its marker — so the advance it skips would have been a no-op regardless. The two decisions
happen to make each other safe.

That coincidence is the argument for the move, not against it. Leaving the advance inside
`renderNotifications()` would make the marker's correctness depend on a rule living in a
different function, which nothing states and no test protects; the first change to the default
tab rule — remembering the last tab, say, or a third tab — breaks it silently. Moving the line
to the one function that makes the panel visible costs nothing, since it is a move rather than
an addition, and makes the invariant true by construction. The manual test for it is
correspondingly artificial (see Testing step 3), which is what a defensive gate's test looks
like.

**This closes the `advanceLastSeen` housekeeping-backlog item.** That entry describes a
divergence between `advanceLastSeen` and `buildNotificationList` over what "seen" means for an
item the display cap drops. The entry says it needs a design call before being touched. This
is that call: **seen means the panel was on screen**, and a source's marker advances to the
newest item in the payload it was showing. The cap is a display concern and does not enter
into it. Note the divergence was already unreachable in practice, since `fresh` is uncapped
and therefore every new item was always displayed; the visibility gate makes it unreachable by
construction rather than by accident.

### 5. A clicked item is gone from the list for good

Isara's words are "remove these items as I click on the link". Taken literally that is
impossible to observe: `openUrl()` closes the popup on the same click, so there is no moment
where she is looking at a list with the row removed from it. What she can observe is the next
open, and today the row is still there — the gold dot has cleared, but the item remains as
one of the `seen` items filling the list out.

**So the change is to the next open: a clicked item is filtered out of the list permanently.**

Rejected alternative: dim and strike the row instead of removing it. Same storage cost, plus a
CSS state, and it leaves the list accumulating rows the member has explicitly finished with —
which is Jalana's complaint feeding Isara's.

**The key is `source:id`, never the bare `id`.** `NotificationItem.id` is whatever HQ uses
within one source; a sim and a Community News item can both legitimately be `"1234"`. Keying
on the bare id would silently hide an unrelated row in another source, and would do it rarely
enough to look like a ghost.

**The badge is not filtered.** Clicking cannot outrun the marker — see decision 2 — so
teaching `countNew()` about clicks would be work in the background worker that changes no
observable number.

**The write must finish before the popup closes, and today's click handler would not let it.**
`openUrl()` calls `browser.tabs.create()` and then `window.close()` on the same synchronous
turn. `addClicked()` is a read-modify-write: its `set` is issued only after its `get` resolves,
by which time the popup context is gone and the write is dropped. Fire-and-forget would
therefore lose the click most of the time — silently, and precisely on the feature this phase
exists to deliver.

The notification row's handler does not reuse `openUrl()` for this reason. It opens the tab
first, so the member sees no delay, then awaits the write, then closes:

```ts
a.addEventListener('click', async (e) => {
  e.preventDefault()
  // Tab first: the member's navigation must not wait on our bookkeeping.
  browser.tabs.create({ url: item.url })
  // Then the write, AWAITED — window.close() destroys this context, and a
  // read-modify-write started but not finished here is a write that never lands.
  await addClicked(clickedKey(item.source, item.id)).catch(() => {})
  window.close()
})
```

Routing the write through the background worker via `runtime.sendMessage` would also survive
teardown and was rejected as the larger change: a new message type, a new worker handler, and
a second owner for a key the popup is the only writer of.

No timeout guards the await. If `storage.local` hung, the member would already have their tab
and would be looking at a popup that failed to close — a worse outcome to engineer around than
to accept.

### 6. What "Off" means, revised

Phase 3.1 decision 3 said the section is always present, so the feature cannot disappear at
the moment someone goes looking for it. That still holds within the tab.

When **every** source is switched off in options, the tab strip does not render at all and the
popup is the launcher alone, exactly as it looks today when `state: 'disabled'` hides the
section. A tab whose only possible content is "you turned this off" is not worth a tab.

## Architecture

```
popup.ts (once, at open)
  Promise.all([ renderPins(), personalize(), renderNotifications() ])
                                               │  reads notifItems + notifLastSeen
                                               │        + prefs + notifClicked
                                               │  buildNotificationList()   ← pure
                                               │  prune notifClicked against payload
                                               ▼
  selectDefaultTab(getCachedCount(), enabled.length)   ← pure
                                               │
                        ┌──────────────────────┴───────────────────┐
                   showLauncher()                             showNotifs()
                   hidden toggles only                    hidden toggles only
                                                          + await setLastSeen(advanceLastSeen(…))
                                                          + THEN notif:refresh

  row click → tabs.create(url) → await addClicked(`${source}:${id}`) → window.close()
              (not openUrl() — it closes synchronously; see decision 5)

storage.local: notifItems, notifCount, notifLastSeen, notifClicked, prefs, pins
```

### Markup — `src/popup/popup.html`

`#launcher` becomes the container for the tab strip and both panels. `#results` still replaces
the whole of `#launcher`, so search remains global and spans both tabs.

```html
<div id="launcher">
  <div id="tabs" class="tabs" role="tablist" hidden>
    <button id="tab-launcher-btn" class="tab" role="tab" aria-controls="tab-launcher"
            aria-selected="true">Launcher</button>
    <button id="tab-notifs-btn" class="tab" role="tab" aria-controls="tab-notifs"
            aria-selected="false">New for you<span id="tab-count" class="tab-count" hidden></span></button>
  </div>

  <div id="tab-launcher" role="tabpanel" aria-labelledby="tab-launcher-btn">
    <nav id="grid" class="grid" aria-label="Quick launch"></nav>
    <section id="mystuff" class="sec" hidden>…</section>
    <section id="pins" class="sec">…</section>
    <section id="staff" class="sec staff" hidden>…</section>
    <section id="feedback" class="sec">…</section>
  </div>

  <div id="tab-notifs" role="tabpanel" aria-labelledby="tab-notifs-btn" hidden>
    <div id="notiflist" class="notiflist"></div>
  </div>
</div>
```

The `<span class="lbl">New for you</span>` label inside the old `#notifs` section is deleted —
the tab is the label now. The `#notifs` section wrapper goes with it; `#tab-notifs` is the
panel.

**Keyboard behaviour:** Left/Right arrows move between the two tabs and **activate on arrival**
— the ARIA "automatic activation" pattern, appropriate here because both panels are already
rendered so showing one costs nothing. `Home`/`End` are omitted: with two tabs they duplicate
the arrows. The inactive tab carries `tabindex="-1"` so a single Tab press enters the panel
rather than walking the strip. Real `<button>`s, so Enter and Space work without handlers.

Note the consequence, which is intended: arrowing onto New for you advances the marker, because
arriving is seeing. There is no way to pass through the tab without landing on it.

### New pure function — `selectDefaultTab()`

Lives in `src/lib/notification-list.ts` alongside the other pure list logic, so the popup keeps
no untested branching:

```ts
export type PopupTab = 'launcher' | 'notifs'

/**
 * Which tab the popup opens on.
 *
 * `enabledCount` of zero means every source is switched off, in which case
 * there is no tab strip at all and the launcher is the whole popup.
 */
export function selectDefaultTab(newCount: number, enabledCount: number): PopupTab {
  if (enabledCount === 0) return 'launcher'
  return newCount > 0 ? 'notifs' : 'launcher'
}
```

### Store — `src/lib/notifications-store.ts`

Three functions and one guard join the existing module rather than starting a new one; this is
notification storage and it already owns `notifItems`, `notifCount` and `notifLastSeen`.

```ts
const CLICKED_KEY = 'notifClicked'

/** `${source}:${id}` — never the bare id; ids are only unique within a source. */
export function clickedKey(source: NotificationSource, id: string): string {
  return `${source}:${id}`
}

export async function getClicked(): Promise<string[]>
export async function addClicked(key: string): Promise<void>

/**
 * Drop stored keys whose item is no longer in the payload, bounding the array
 * to the size of one payload instead of growing without limit.
 *
 * ONLY keys belonging to a healthy source are eligible. A source that is absent
 * from the payload, or flagged `unavailable`, keeps every key it has.
 */
export async function pruneClicked(sources: NotificationsResponse['sources']): Promise<void>
```

**Pruning is scoped to healthy sources, and that is the whole correctness of it.** Naively
pruning against "everything in the payload" makes a Discord outage un-click every announcement
a member has read: the source comes back an hour later, its items return, and rows she
deliberately dismissed are all sitting there again. So `pruneClicked` computes the live key set
only from sources present in the payload with no `unavailable` flag, and only considers stored
keys whose `source:` prefix names one of those sources. Keys under a sick or missing source are
left exactly as they are.

`pruneClicked` is not called at all when `getCachedItems()` returns `null` — the render already
returns early in that state, and pruning against a cache we could not read would delete on the
strength of no evidence.

The bound still holds. HQ returns the most recent items per source, so a clicked item that ages
out of the payload is pruned and cannot return; the array converges on the size of one healthy
payload. During an outage it holds the sick source's keys as well, which is a bounded and
temporary excess of short strings.

`addClicked` is read-modify-write on a single extension-local key with no concurrent writer
(one popup at a time, and the worker never touches this key), so it needs no lock.

### List — `src/lib/notification-list.ts`

`buildNotificationList()` takes one more parameter and filters before it partitions:

```ts
export function buildNotificationList(
  sources: NotificationsResponse['sources'],
  lastSeen: LastSeen,
  enabled: NotificationSource[],
  clicked: ReadonlySet<string> = new Set(),
  cap: number = LIST_CAP
): NotificationListResult
```

Filtering **before** the partition is what makes a removed row backfill: dropping a `seen`
item frees a slot that `seen.slice(0, cap - fresh.length)` then fills from the next item down,
rather than leaving a gap. The `clicked` parameter defaults to an empty set so every existing
call site and test keeps compiling and keeps meaning what it meant.

A clicked item that is still `fresh` is filtered out too. That is correct and is the point:
she opened it, so it is not new to her, whatever the marker says.

### Popup — `src/popup/popup.ts`

- `renderNotifications()` renders into `#tab-notifs`, reads `getClicked()`, calls
  `pruneClicked()`, and **no longer advances the marker**.
- `showNotifs()` / `showLauncher()` toggle `hidden` and `aria-selected`. `showNotifs()`
  additionally **awaits** `setLastSeen(...)` and only then fires `notif:refresh` — the worker
  recomputes the badge from the stored marker, so a refresh racing ahead of the write would
  count against the old marker and put the number straight back.
- **`showNotifs()` advances from the snapshot `renderNotifications()` rendered, never by
  re-reading storage.** `renderNotifications()` stashes the `{ cached, lastSeen, enabled }` it
  used in a module-level variable, and `showNotifs()` calls
  `advanceLastSeen(lastSeen, cached, enabled)` against exactly that. Re-reading would let a
  worker poll landing between render and tab-click mark an item seen that was never on screen —
  the identical failure Phase 3.1 decision 1 removed when it deleted `markAllSeen()` from the
  worker, and the reason the popup owns this write at all. If the stash is absent (the panel
  never rendered), `showNotifs()` advances nothing.
- `buildNotifRow()`'s click handler does **not** call `openUrl()` — it opens the tab, awaits
  `addClicked(clickedKey(item.source, item.id))`, then closes. See decision 5 for why the
  await is mandatory rather than tidy. A rejected write is caught and swallowed; the row simply
  persists to the next open.
- The tab count pill uses `badgeText()`, so it reads `9+` past nine exactly like the toolbar.
  It is written once at open and never changes during the visit.

### The states, revised

| State | Condition | Popup shows |
|---|---|---|
| Items | cache non-null, `state: 'ok'`, one or more items | Tab strip, list in the panel |
| Quiet | cache non-null, `state: 'ok'`, zero items | Tab strip, panel says **"Nothing new right now."** |
| Checking | `getCachedItems()` returns `null` | Tab strip, panel says **"Checking for updates…"**, fire `notif:refresh` |
| Outage | `state: 'outage'` | Tab strip, panel says **"Couldn't reach HQ — this list may be out of date."** |
| Off | `state: 'disabled'` / `enabled.length === 0` | **No tab strip**; launcher is the whole popup |

Only the Off row changes from Phase 3.1. The other four move from a section to a panel and say
the same words.

Quiet is reachable in a new way now: every item in a quiet-but-non-empty payload has been
clicked. The wording still fits.

## Testing

**Unit — `tests/notification-list.test.ts`:**

- a clicked item is absent from the result
- a clicked `seen` item backfills — with `cap: 2`, three seen items and the first clicked, the
  result holds items two and three, not one and two with a hole
- a clicked `fresh` item is filtered out and does not count toward the cap arithmetic
- `source:id` isolation: `announcements:1` clicked leaves `news:1` present
- `selectDefaultTab`: `(0, 3) → launcher`, `(1, 3) → notifs`, `(5, 0) → launcher`
- the default `clicked` parameter leaves every existing assertion unchanged

**The backfill test's fixture size is load-bearing.** Three seen items against `cap: 2` is the
minimum that can tell filter-before-partition from filter-after: with two items and `cap: 2`
there is no third item to backfill from, and the mutated code passes. Do not "simplify" that
fixture down without re-running the mutation — see `.claude/rules/dev-process.md` on fixture
size.

**Unit — `tests/notifications-store.test.ts`:**

- `getClicked` round-trips, and returns `[]` for absent, non-array, and mixed-type stored values
- `addClicked` is idempotent — adding the same key twice stores it once
- `pruneClicked` drops a key absent from the payload and keeps one present in it
- **`pruneClicked` keeps every key of a source flagged `unavailable`**, and every key of a
  source missing from the payload — the outage case from decision 5
- `pruneClicked` on a payload of healthy-but-empty sources drops those sources' keys rather
  than throwing

**Mutation check, per `.claude/rules/dev-process.md`.** Each of these gets a deliberate break
and a confirmed red before the phase is called done, then reverted:

| Mutation | Test that must go red |
|---|---|
| Drop the `clicked` filter from `buildNotificationList` | "a clicked item is absent" |
| Key on bare `id` instead of `source:id` | "`source:id` isolation" |
| Filter after the partition instead of before | "a clicked `seen` item backfills" |
| Invert `newCount > 0` | `selectDefaultTab` cases |
| Make `pruneClicked` a no-op | "`pruneClicked` drops a key absent from the payload" |
| Let `pruneClicked` treat an `unavailable` source as healthy | "keeps every key of a source flagged `unavailable`" |

**Manual, in both browsers**, since the tab strip and marker gating are DOM behaviour that the
unit tests do not reach:

1. With items new, the popup opens on New for you and the toolbar badge clears.
2. With nothing new, it opens on Launcher and Pinned is visible without scrolling.
3. **The marker gate, which needs a forced setup.** Decision 2 means a member with new items
   always lands on New for you, so the hidden-panel case cannot be reached by using the popup
   normally. Force it: temporarily edit `selectDefaultTab` to `return 'launcher'`, load the
   unpacked build with items new, open the popup, close it without touching the tab strip —
   **the badge is still there** — then revert the edit. Same discipline as the mutation checks
   above, and the only way to see decision 4 do its job.
4. Switch to New for you and back twice — the gold dots stay lit for the whole visit, and the
   tab count does not change mid-visit. Nothing re-renders on a switch (decision 3), and the
   `notif:refresh` that `showNotifs()` fires primes the cache for the *next* open only, exactly
   as Phase 3.1 established for the badge.
5. Click an item, reopen — the row is gone, and one older item has taken its place.
   Then prove the await is doing the work, since devtools cannot throttle extension storage:
   drop `await new Promise((r) => setTimeout(r, 2000))` into `addClicked` just before its
   `set`, reload, click a row — the popup should visibly hang open for two seconds and the row
   should still be gone on reopen. Remove the delay, then remove the `await` in the handler and
   confirm the row comes **back**. Restore both.
6. Switch every source off in options — no tab strip, launcher fills the popup.
7. Keyboard only: Tab to the strip, arrow Right onto New for you. **Arrowing activates**, so
   the panel shows and the marker advances on the arrow press, not on a separate Enter — with
   two tabs, moving to one is choosing it, and both panels are already rendered so activation
   costs nothing. Tab once more and focus enters the panel, not the other tab button.

## Out of scope

- Cross-device sync of clicked or seen state. Nothing about what a member has read leaves
  their machine, and that is a stated privacy property of the extension.
- A "mark all read" control. Showing the panel already does it.
- Notification history, or any way to see a clicked item again from inside the popup. If this
  turns out to be wanted, it is a later phase with its own spec.
- Per-source tabs or filtering within the panel.
- Any HQ change. `GET /api/me/notifications` is untouched.
- The second housekeeping-backlog item, extracting the notification block out of `popup.ts`.
  That file grows in this phase; the extraction is still worth doing and is still not this.
- **A DOM harness around `popup.ts` itself.** Importing that module runs its
  `DOMContentLoaded` wiring and pulls in the whole popup graph; standing that up is larger than
  either feature here. The awaited click write and the full first-render path stay covered by
  the manual steps above.

**Correction, found while planning (2026-08-28).** An earlier draft of this section deferred
*all* automated DOM tests on the grounds that "there is no jsdom harness and standing one up is a
larger change." That was wrong on the facts: **`jsdom` is already a devDependency** (unused —
nothing sets `environment: 'jsdom'`), and `tests/notifications-store.test.ts` already has a clean
`vi.mock('webextension-polyfill')` storage double to copy. Enabling jsdom for one file is a
single `// @vitest-environment jsdom` comment.

So the two most load-bearing behaviours **do** get automated tests, by extracting the tab
controller into its own module:

- **`src/popup/tab-strip.ts`** owns the strip: which panel is visible, `aria-selected`,
  roving `tabindex`, arrow-key activation, and an `onShow(tab)` callback. It takes its elements
  as arguments and imports nothing from `popup.ts`, so it is testable under jsdom on its own.
- That makes decision 3 (**switching never re-renders**) and decision 4 (**the marker advances
  on show**) assertable: the test counts `onShow` calls and asserts the render function is
  called exactly once across many switches.

Only the wiring in `popup.ts` — which elements get passed in, and the click handler — stays
manual. That is a much smaller uncovered surface than the original deferral claimed, and it costs
one new file that the popup wanted anyway.

## Settled before planning

Three calls Jordan made on 2026-08-28, recorded here so the plan does not re-open them.

1. **The v0.4.0 release notes say the badge now persists until you look at the list.** One line,
   in the release notes and in the forum reply. It is a visible behaviour change and reads as a
   surprise to anyone who never noticed the old one.
2. **A clicked item gets no way back.** No history view, no undo, no "show dismissed". If a
   tester asks for one it is a later phase with its own spec.
3. **ClaudeAI writes the replies to Jalana and Isara on topic 4180, after v0.4.0 is launched and
   live-verified** — never before. Both replies name the person who asked, as the previous rounds
   did.

## Risks

- **The tab strip costs vertical space on a 360px-wide popup**, and it costs it on every open
  including quiet ones. Mitigated by keeping the strip to one line of text with no icons.
- **Firefox does not persist the extension across restarts** while it is unsigned, so a tester
  who reinstalls loses `notifClicked` along with everything else. Expected, and it goes away
  when the add-on is published.
- **`notifClicked` grows between prunes**, bounded by how many items a member clicks in one
  visit. The prune on the next render brings it back to payload size. A member who clicks
  twenty items in one sitting stores twenty short strings until then.
- **A member who reads via the badge alone will now see it persist** where it previously
  cleared on any open. That is the fix, not a regression, but it is a visible behaviour change
  worth naming in the release notes.

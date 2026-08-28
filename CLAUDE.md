# SB118 Browser Extension

Browser extension for the StarBase 118 community — launcher + search + personalized dashboard for all SB118 web properties. **SB118-only** (StarBase118 org, ufopsb118 account). No CH/MFC coupling.

**Start here when picking this up:** [`ROADMAP.md`](ROADMAP.md) has phase status + the "pick up here" for the staff test round.

## v0.2.0 — staff test build (2026-08-08)

Phase 3 (awareness) is shipped and merged to `main` (PR #1 `0772e65`). Released as
**v0.2.0** (PR #2 `8b82959`) and distributed via a **GitHub Release**, not the browser
stores: https://github.com/StarBase118/sb118-browser-extension/releases/tag/v0.2.0
(marked prerelease, two zips — `sb118-extension-chromium-0.2.0.zip` /
`sb118-extension-firefox-0.2.0.zip`, each unpacking to one clearly-named folder).
Store distribution (Chrome Web Store / Edge / AMO — needs SB118 developer accounts + a
hosted privacy policy) is deliberately deferred to fleet-wide launch, not this round.

**What Phase 3 added:** an MV3 background alarm polls `GET /api/me/notifications` every
15 minutes, counts items newer than a per-source last-seen marker in `storage.local`, and
badges the toolbar icon (capped "9+"). Per-source toggles on the options page narrow the
`sources=` query param HQ receives. First-run explainer. The popup counts notifications but
does **not** list them yet — that's Phase 3.1, a deliberate scope line, documented as a known
gap everywhere testers will look (STAFF-TEST.md, the release notes, the forum announcement).

A corrupt last-seen marker used to silently pin a source's badge count at zero while looking
calm — fixed in review before merge (Codex wrote the diff, Claude reviewed and caught this)
to count all items instead, same as a missing marker, with a regression test.

**Staff test round is live** — announced on staff Discourse (topic 4180,
https://staff.starbase118.net/t/sb118-browser-extension-test-build-ready-to-try/4180),
posted as ClaudeAI (user 230, `hq-devnotes` group) via `rails runner` — see `sb118/CLAUDE.md`
→ Discourse section for the posting mechanism and a hashtag-autolink gotcha hit while writing
it. Issue templates for this round: `.github/ISSUE_TEMPLATE/test_feedback.yml` (low-friction
"what did you notice" form) alongside the existing `bug_report.yml`. Labels added (additive):
`staff test`, `known gap`, `area: badge/search/launcher/options/build/hq-endpoint`, `firefox`,
`chromium`.

### v0.2.1 — staff test build, feedback round 1 (2026-08-09)

Same distribution as v0.2.0: a **GitHub Release**, marked prerelease, two zips.
Testers replace the folder they loaded and hit reload on the extensions page.

**Zips are now built by `npm run package`**, not by hand. It rebuilds both targets
into `release/` (gitignored) as `sb118-extension-<target>-<version>.zip`, each
unpacking to one clearly-named folder — testers point "Load unpacked" at a folder,
so loose files at the zip root are a support burden. It **fails the build if a
manifest's version doesn't match `package.json`**, which is the one thing that is
easy to half-do: a version lives in three files (`package.json`,
`src/manifest.chromium.json`, `src/manifest.firefox.json`) and all three must move.

## v0.3.0 — Phase 3.1, the popup lists what the badge counted (2026-08-13)

Closes the gap Phase 3 shipped on purpose and Lhandon asked about in topic 4180 #7: the
badge said "3" and nothing said what the 3 were. **No HQ change** —
`GET /api/me/notifications` already returned every item with `id`/`title`/`url`/`at`; the
worker was counting them and throwing them away.

Spec: `docs/superpowers/specs/2026-08-13-sb118-extension-phase31-notification-list-design.md`
(companion `spec-companion-phase31.html`). Plan:
`docs/superpowers/plans/2026-08-13-phase31-notification-list.md`.

**Five things worth not re-deriving:**

- **The popup renders the worker's cached payload (`notifItems`) and never fetches.** One
  fetch path, no loading state, and the list cannot disagree with the badge because it is
  the same data that produced the count. The cost is up to 15 minutes of staleness, which
  is exactly the staleness the badge already had.
- **The popup is the ONLY writer of `notifLastSeen`.** `markAllSeen()` is deleted and the
  `notif:seen` message is gone. The worker cannot do this correctly: it reads the cache
  when the message arrives, which is *later* than the popup rendered it, and the message
  carries nothing identifying which snapshot was on screen — a poll landing in between
  marks an item seen that was never displayed. The popup holds that snapshot, so it
  computes `advanceLastSeen()` from it and calls `setLastSeen()` directly, **after** the
  rows are in the DOM. That ordering is the feature: dots stay lit for the visit that
  revealed them.
- **`buildNotificationList()` PARTITIONS new from old — it does not sort the merged list
  and slice it.** Markers are per source, so "new" is not a function of absolute time
  across the list: with the sims marker an hour old and the news marker three days old, a
  *read* sim from five hours ago sorts above an *unread* news item from two days ago, and
  a time-sorted slice at the cap drops the unread one. Regression test: "keeps an unread
  item that is older than the read items filling the cap" — mutation-tested by swapping in
  the naive slice and confirming it goes red.
- **`getCachedItems()` returns `null` for absent, unparseable, or wrong-shape data, and a
  payload object otherwise — including an empty one.** Null is "we have not successfully
  looked" (→ "Checking for updates…" plus a refresh); an empty payload is "we looked and it
  was quiet" (→ "Nothing new right now."). Telling a member nothing is new on the strength
  of a cache we could not read would be a claim we have not earned. **Quiet and Checking
  are told apart by the getter's return value, not by item count.**
- **An ABSENT source is not an unavailable one.** Only an explicit `unavailable: true` flag
  counts as evidence something failed. Conflating them made a completely empty payload
  (`{}`) render "Couldn't reach HQ" for a perfectly healthy quiet cache — **found by the
  end-to-end run, not the unit tests**, because the unit test for the quiet case was
  written as `{ news: { items: [] } }`, a present-but-empty group that takes the other
  branch. Both shapes are covered now.

**Deleted, not deprecated:** the first-run explainer (`renderNotificationIntro`, the
`#notif-intro` element, its CSS, and the `notifIntroDismissed` pref). It existed to explain
a bare number. There is also no "Mark all read" control — opening the popup already marks
everything read, so the button would do what just happened.

**`scripts/e2e-notifications.mjs`** drives the real built extension in a headed Chromium
persistent context (headless does not start MV3 service workers). Nine checks. The one that
matters most writes a newer item into the cache while the popup is open and asserts it is
still unread on the next open — that is the race the popup-owns-the-marker design exists to
close, and a unit test cannot prove it.

## v0.4.0 — Phase 3.2, a tab for the notifications and clicked items that stay gone (2026-08-28)

Both changes come from staff-test feedback round 3 on topic 4180, a day after v0.3.0.
**No HQ change** — `GET /api/me/notifications` is untouched again.

Spec: `docs/superpowers/specs/2026-08-28-sb118-extension-phase32-tabs-and-clicked-items-design.md`
(companion `spec-companion-phase32.html`). Plan:
`docs/superpowers/plans/2026-08-28-extension-phase32-tabs-and-clicked-items.md`.

**Jalana (#11) — the list pushed Pinned off the bottom.** The popup is now two tabs,
**Launcher** and **New for you**, opening on whichever has something to say: the
notifications tab when the cached badge count is above zero, the launcher otherwise. This
supersedes Phase 3.1's decision 4 ("below the grid, above Pinned"). Moving the list to the
bottom was the smaller diff and was rejected — the badge would then point at something you
have to scroll to find, which is most of what Phase 3.1 was for.

**Isara (#13) — a clicked item was still listed next time.** A `notifClicked` array in
`storage.local` filters them out for good. Keys are `` `${source}:${id}` `` — never the bare
id, because `NotificationItem.id` is only unique *within* a source, so `announcements:1` and
`news:1` are different items that share an id.

### Three things reading the code turned up that the feedback did not

- **`LIST_CAP = 8` never bounded Jalana's case.** The cap only trims already-*seen* items —
  the fresh/seen partition is deliberate so a time-sort can't drop an unread item to make
  room for a read one. Nobody had written down the consequence: `fresh` is uncapped, so
  "50 new things" really does render 50 rows.
- **A fire-and-forget click write would have been lost most of the time.** `openUrl()` calls
  `window.close()` on the same synchronous turn, and `addClicked` is a read-modify-write
  whose `set()` only issues after its `get()` resolves — by then the popup context is gone.
  The notification row therefore does **not** use `openUrl()`: it opens the tab first (so the
  member sees no delay), **awaits** the write, then closes.
- **Pruning the clicked set against the whole payload un-clicks everything during an
  outage.** A source flagged `unavailable` or absent keeps every key it has; only healthy
  sources are pruned. Otherwise one Discord outage makes every dismissed announcement
  reappear an hour later when the source recovers.

### "Seen" now means the panel was on screen

`advanceLastSeen()` moved out of `renderNotifications()` and into the tab strip's `onShow`
callback. The panel renders on every open, including opens that land on Launcher — leaving
the advance at render time would clear the badge for a member who never looked, silently.

**This is the visible behaviour change in v0.4.0**: previously *any* popup open cleared the
badge. It is called out in the release notes and the forum reply for that reason.

It also closes the `advanceLastSeen` housekeeping-backlog item, which was waiting on exactly
this decision. Note the gate is currently defensive rather than load-bearing: under the
default-tab rule the panel is hidden at open only when the count is zero, in which case the
advance it skips would have been a no-op anyway. The two rules happen to make each other
safe, which is the argument for putting the line where it is obviously right rather than
where it is accidentally right.

### `src/popup/tab-strip.ts` — a new module, and why

The strip owns visibility, `aria-selected`, roving `tabindex` and arrow-key activation
(automatic: with two tabs, arriving is choosing). It takes its elements as arguments and
imports nothing from `popup.ts`, so it is unit-testable on its own.

**It must never write panel content**, and there is a test asserting exactly that. The gold
"new" dots are computed once at render from a marker that has already advanced, so anything
re-rendering a panel on a tab switch wipes every dot mid-visit — the failure Phase 3.1's
decision 1 exists to prevent, reintroduced through a new door.

### Testing — and one thing the tests do NOT prove

195 tests (up from 163). Eight mutation checks were run and independently re-run:
dropping the clicked filter, keying on the bare id, filtering after the partition instead of
before, inverting the default-tab comparison, no-op'ing the prune, letting the prune treat an
`unavailable` source as healthy, making `show()` wipe the panel, and firing `onShow` for only
one tab. All eight turn a named test red.

`tests/popup-tabs.integration.test.ts` boots the real `popup.ts` against the real
`popup.html` under jsdom. The `DOMContentLoaded` handler is **intercepted at registration**
rather than dispatched — re-importing the module leaves its listener on the shared jsdom
`document`, which survives a body swap, so a plain dispatch on the fourth boot fires four
handlers and every call-count assertion reads garbage.

**The tests do not prove the `await` on the clicked write matters.** Replacing it with
fire-and-forget leaves them green, because jsdom's `window.close()` is a no-op that never
destroys the context. Only a real popup teardown distinguishes the two. That claim stays
manual, and the test file says so where a reader will see it.

### Two bugs Claude caught reviewing Codex's diffs

- **The notification list lost its side padding.** It used to sit inside
  `<section class="sec">`, which is where `12px 14px` came from; its own tab panel had none,
  so rows ran flush to the edge of a 360px popup. Invisible in the diff — every id was
  preserved and the structure was exactly as planned. Caught by inlining `popup.css` into
  `popup.html` with sample rows and rendering it in headless Chrome.
- **`Promise.all(...).then(mountTabs)` tied the tab strip to unrelated renders.**
  `renderPins()`, `personalize()` and `renderNotifications()` had always failed
  independently; `all` meant a rejection in any of them skipped `mountTabs`, leaving `#tabs`
  and `#tab-notifs` both hidden — the popup degrading to launcher-only with the notifications
  unreachable and nothing on screen saying why. Now `allSettled`.

### Not in this release, deliberately

No cross-device sync of read or clicked state (nothing about what a member has read leaves
their machine, and that is a stated privacy property). No "mark all read" — showing the panel
already does it. No history view or way to recover a clicked item; if a tester asks, that is
its own phase. No per-source tabs. No DOM harness around `popup.ts`'s first-render path
beyond the integration file above.

## Housekeeping backlog

- ~~**`advanceLastSeen` re-scans the payload that `buildNotificationList` already walked**~~
  — **RESOLVED in v0.4.0.** The design call it was waiting on got made: "seen" means the
  panel was on screen, so the advance moved into the tab strip's `onShow` and the display cap
  does not enter into it. Original entry below for context.
- **`advanceLastSeen` re-scans the payload that `buildNotificationList` already walked** —
  same divergence risk `isItemNew` was extracted to close, found in the 2026-08-13
  `/simplify` pass (PR #11) and deliberately left alone rather than fixed as a drive-by.
  The reason it's not a trivial dedupe: the two functions don't currently agree on what
  "seen" means for an item the 8-item display cap drops — today those items get marked
  read without ever being shown, and folding `advanceLastSeen` into the list builder would
  either keep or change that, which is a design call, not a refactor. Needs a decision
  before it gets touched.
- **The ~110-line notification block inside `popup.ts` (556 lines total) is a real seam**
  worth its own module — also flagged by the same `/simplify` pass and left alone because
  it's a genuine extraction, not a drive-by cleanup.

### v0.2.2 — staff-test feedback round 2 (topic 4180 #4–#7) — 2026-08-13

Same distribution as before: a prerelease GitHub Release, two zips from `npm run package`.
Also carries the previously-unreleased PR #6 simplify sweep.

- **The toolbar icon was a plain blue square.** Not a rendering problem — `src/icons/icon*.png`
  were literal solid `#1D72A6` fills, never replaced with real art. Now the SB118 delta in
  white on a brand-navy rounded plate, so it reads on both light and dark toolbars.
  **`scripts/make-icons.py` regenerates all three sizes** from
  `sb118/branding/logos/SB118_logo_favicon512x512_white.png` (outside this repo, which is why
  the PNGs are committed rather than built). **16px gets its own mark scale (0.94) and a
  tighter corner radius** — the gap between the two chevrons is about one pixel there, so the
  margin that looks right at 128px is exactly what turns the mark to mush at 16.
- **"＋ Add link" — pin a page you are not currently on.** "Pin tab" can only reach the tab
  you're on, which is no use for the pages a member wants *while* they're elsewhere (the
  staff-test example was PNPC wiki pages). Reuses the pin storage, so a manually added link
  renames and unpins like any other chip; the only new thing is the typed address, which goes
  through **`normalizePinUrl()`** — a bare host is assumed https rather than rejected, and
  **anything that isn't http(s) is refused before it can be stored**, because a chip is opened
  with `browser.tabs.create()` and `javascript:`/`data:` must never reach that call.
  Verified end-to-end against the built extension in Chromium, not just unit-tested.

**Deliberately not in this release: Phase 3.1** (list the notifications rather than only
counting them), which is what Lhandon's mockup in #7 is asking for. It needs its own spec and
would have held up two small visible fixes.

### Staff-test feedback round 1 (Jalana, topic 4180 #2) — fixed

Two reports, one of which was an HQ bug rather than an extension bug:

- **A pinned tab showed the whole page title.** Labels come from `tab.title` and
  nothing ever wrote them again. Pins now render through `src/lib/pin-chip.ts`:
  the label is truncated in CSS (`.chip-label`) with the full text on the chip's
  `title`, and a ✎ button edits it in place (`renamePin()` in `src/lib/pins.ts`).
  **The rename edits in place rather than calling `prompt()`** — a modal raised
  from a browser-action popup can dismiss the popup underneath it.
- **The ship chip opened the HQ dashboard instead of the ship's wiki page.** Root
  cause was in HQ, not here: `/api/me` hardcoded `ship: { wikiUrl: null }` while
  the character beside it resolved a real URL. Fixed by `resolveShipWikiUrl()` in
  megatool's `src/lib/member-context.ts`, reading `ships.wiki_url` (populated for
  all 11 fleet rows). The extension's half was a silent
  `url ?? 'https://hq.starbase118.net'` fallback that turned a missing URL into a
  working-looking link to the wrong place — a chip with no URL now renders as
  plain text (`.chip.nolink`).

**Open before this can go further:**
1. **Firefox two-browser smoke test** — Jordan needs to load `dist/firefox` while signed
   into HQ and confirm the login light goes green (proves Firefox carries the session
   cookie via `credentials:'include'`). Playwright can side-load into Chromium but not
   Firefox, so this needs a human with a real Firefox install. If grey: build the
   content-script relay fallback specified in the Phase 1 plan, Slice 5.
2. Eyeball the "My character" wiki link while signed in (deployed, never visually confirmed).
3. ~~Phase 3.1 (list the notifications, not just count them)~~ — **shipped as v0.3.0
   (2026-08-13)**, see above.
4. ~~**PR #6 is merged (`fad8808`) but deliberately NOT released**~~ — released as part of
   **v0.2.2** (2026-08-13). Original reasoning kept below for the record: the `/simplify` sweep of
   the round-1 fix (announcements with no URL no longer render `<a href="#">`, label dedupe,
   combined CSS, shared `scripts/targets.mjs`). No v0.2.2 was cut because **HQ's `/api/me`
   returns `announcements: []` unconditionally** (`route.ts:72`), so the announcement fix sits
   in a path that cannot execute yet and the rest is build tooling — a release would have been
   zero observable change and a re-install for every tester an hour after v0.2.1. It ships with
   the next real release, whenever Phase 3.1 or the next fix lands.

   **Resolved 2026-08-26:** Phase 3.1 shipped announcements through the `#notifs` list fed by
   `/api/me/notifications`, so the old `#announce` section was superseded rather than waiting on
   HQ. That render block, its HTML section, its CSS, and the `announcements` field it read have
   all been deleted here; the stub came off HQ's side in megatool PR #1187.

## ⏭ Picking this up (as of 2026-07-26)

Phase 2 is **designed and approved**; one of its four tracks is **shipped**.

- **Spec:** `docs/superpowers/specs/2026-07-26-sb118-extension-phase2-search-design.md`
  (readable companion: `spec-companion-phase2.html` in this repo)

**Phase 2 = four sources, three network calls, one local match.** Destinations (HQ pages) match locally from `nav[]`; wiki, main site and staff forum are fetched in parallel and each group renders as it lands.

| Track | State | Next step |
|---|---|---|
| **1. HQ (megatool)** | ✅ `nav[]` live on `/api/me` (PR #751, prod `2151f3d1`); forum route live (PR #989, `4d9df681`) | See "Forum search" below |
| **2. main-site** | ✅ Live | Public `GET /api/search` on www returns news + pages + sims (site PR #103) |
| **3. extension UI** | ✅ Done | Search box wired to all four sources — see "Search (Phase 2, track 3)" below |
| **4. repo public** | ✅ Done | MIT license, SECURITY.md, issue templates, install + privacy docs (PR #3) |

### Forum search — how it stays correctly permissioned (shipped 2026-08-08)

The query runs **as the member who typed it**, so Discourse itself applies that member's
category permissions. HQ proxies it at `GET /api/search/forum`, which is where the staff gate
lives (`/api/search/*` is outside the middleware matcher, same as `/api/me`).

Two Discourse credentials, deliberately separate:

1. `SB118_DISCOURSE_ADMIN_API_KEY` (as `system`, read-only) resolves the Authentik `sub` to a
   Discourse username via `GET /u/by-external/oidc/:sub`, cached 1h.
2. `SB118_DISCOURSE_SEARCH_API_KEY` — an **All Users** key, granular-scoped to `search`, sent
   with `Api-Username: <that member>`.

**Do not collapse these into one privileged query filtered afterwards** — that inverts the
permission model, puts the gate in our code instead of Discourse's, and `system` sees private
messages.

**The usernames do not match.** Discourse links HQ accounts to Authentik through
`user_associated_accounts` (provider `oidc`), not by name — the forum's usernames came from
the IPB migration, so Authentik `wolf` is Discourse `Jordan_FltAdmlWolf`. There are zero
`single_sign_on_records` rows. A member who has never signed into the forum via Authentik has
no association row and correctly gets an `unavailable` forum group, not an empty one.

Full writeup: Tech KB → "Discourse usernames are not Authentik usernames"
(`3b6c3f472748819b916eee44e7142542`).

**Two corrections carried forward, so they aren't re-derived:**
- Discourse's missing CORS headers do **not** block a direct extension fetch — an MV3 extension bypasses CORS for hosts in `host_permissions` (that is how Phase 1's `/api/me` fetch works). The proxy-through-HQ design stands on enforcement + browser-consistency grounds, not CORS.
- The sim archive is **already searchable** on the main site (Postgres, backs `/sims/search`). The original spec's "deferred pending the Aria migration" was stale.

## Search (Phase 2, track 3 — 2026-08-07, on `main`)

The popup search box is live. Four sources, three requests, one local match:

| Module | Does |
|---|---|
| `src/lib/nav-cache.ts` | Stores the HQ page list from `/api/me`'s `nav[]` |
| `src/lib/destinations.ts` | Matches + ranks that list locally (pure, no I/O) |
| `src/lib/search-sources.ts` | Wiki / main-site / forum clients — each fails on its own |
| `src/lib/search.ts` | Fans out, emits each group as it lands, honours one abort signal |
| `src/lib/search-types.ts` | The shared hit/group shape and the tuning constants |

**All four groups return results as of 2026-08-08.** The "unavailable" rendering is still the
designed degradation for a source whose request fails or times out — it must never collapse
into an empty group, or an outage reads as a clean no-match.

**Five decisions worth not re-deriving:**

- **The nav cache is cleared on anything short of an authenticated `/api/me`**, and replaced
  wholesale rather than merged. It outlives the popup, so without the clear a signed-out user
  keeps seeing and matching the previous session's page list; without the wholesale replace,
  a group they have left keeps its pages. `syncNavCache()` owns both rules and is tested for
  each.
- **Destinations are emitted before the debounce, not after it.** They are a local match
  against a small list — there is no request to save by delaying them, and delaying them is
  what would make the box feel slow.
- **Every emit is gated on the caller's `AbortSignal`.** One controller per keystroke; a
  response for an older query cannot land on top of newer results even if it resolves late.
- **A failed source is `unavailable`, never an empty group.** A search where everything
  failed has to look like a failure — "no matches" for a request that never completed is a
  lie the member cannot detect.
- **No `www.starbase118.net` host permission was added.** The main-site route sets
  `Access-Control-Allow-Origin: *`, so the fetch works without widening what the extension
  may reach — which also keeps the "Report an issue" reasoning below intact.

`Ctrl+Shift+S` / `Cmd+Shift+S` opens the popup via `commands._execute_action`; the box takes
focus on open, so no extra wiring is needed for the shortcut to land in it.

Design check: `preview/search-preview.html` renders the results state against the real
`popup.css` for screenshotting without loading the extension.

## "Report an issue on this page" (2026-07-28, on `main`)

The popup has a **Report an issue on this page** action that opens HQ's report form
(`/feedback/new`) in a new tab with the active tab's URL and title carried over. Helper:
`src/lib/feedback-link.ts` (`buildFeedbackUrl`), tested in `tests/feedback-link.test.ts`.

**It opens a new tab rather than injecting HQ's in-page panel, and that is deliberate.** The wiki,
main site and staff forum all open the panel in place. Injecting it here would need a `scripting`
permission plus a host permission for every site the extension could reach — `manifest.chromium.json`
requests only `["storage","tabs"]` and its `host_permissions` cover hq/wiki/staff but **not**
`www.starbase118.net`. Both widen what the extension may do and both get re-reviewed at store
submission. The popup is also already a surface the member deliberately opened, so leaving the page
is not the intrusion it would be for an in-page trigger. To change later: add `"scripting"` + the
missing host permission and reuse the loader the other three triggers share. Do it if members ask,
not pre-emptively. Recorded in `ROADMAP.md` under Deferred.

A tab with no URL (a `chrome://` page, or permissions withheld) still gets a usable report form —
it just cannot say which page it is about.

**Also still open from Phase 1:** the Firefox two-browser smoke test, and store distribution accounts (Chrome Web Store / Edge / AMO should publish under a dedicated SB118 account, not Jordan's personal one).

## What it is

Two deliverables:
1. **The extension** (this repo, `StarBase118/sb118-browser-extension`) — MV3, TypeScript + Vite, one Chromium build + one Firefox build. Auth is session-only (no passwords stored).
2. **`GET /api/me`** — read-only endpoint in the **`sb118-megatool`** repo (`src/app/api/me/route.ts`), reads the Authentik/NextAuth session and returns the caller's ship, character (incl. `characters.wiki_url` via `resolveCharacterWikiUrl()` in `src/lib/member-context.ts`), staff flag, **`nav[]`** (added 2026-07-26 — the HQ pages that member may open, built by `src/lib/extension-nav.ts` in megatool). It no longer carries `notifications` or `announcements` — both were permanently-empty stubs and were removed 2026-08-26 (megatool PR #1187) along with this repo's matching dead code. Live awareness data comes from `GET /api/me/notifications`, never from `/api/me`. Classified **member-safe** in the megatool route firewall (`src/__tests__/route-firewall.test.ts`).

## Build & test

```bash
npm install
npm test            # vitest — every src/lib module
npm run typecheck
npm run build       # -> dist/chromium and dist/firefox
```

Load unpacked: Chrome `chrome://extensions` → Load unpacked → `dist/chromium`; Firefox `about:debugging` → Load Temporary Add-on → `dist/firefox/manifest.json`.

## Key facts / gotchas

- **Auth is direct cross-site fetch.** `session.ts`'s `getProfile()` does `fetch('https://hq.starbase118.net/api/me', {credentials:'include'})`. The spike (`docs/superpowers/SPIKE-RESULT.md`) proved Chrome extensions with host permissions carry the `SameSite=Lax` session cookie on this. **Firefox not yet verified** — if the login light is grey in Firefox when signed in, build the content-script relay fallback (specified in the Phase 1 plan Slice 5); keep Chrome on direct.
- **Build path gotcha:** `scripts/build.mjs` emits `popup.js`/`options.js` into their own folders (next to their HTML), background.js at root. A flat emit 404s the popup script at runtime — don't "simplify" it back to `[name].js` at root.
- **`/api/me` is NOT middleware-matched** in the megatool (matcher only covers `/api/v1/*` + pages), so it serves its own 401 and its OPTIONS handler serves the CORS preflight. Any new API route in the megatool must be classified in the route-firewall test (gate in ROUTE_GROUPS or list in MEMBER_SAFE_ROUTES) or CI fails.
- **Design:** popup styling was built via the screenshot-critique loop; design reference renders are in `preview/` (`popup-preview.html`, `real-check.html`). SB118 palette (navy/gold), dark theme.
- **Member launcher** = HQ/Wiki/Discord/Main site/Sim archive (Library removed 2026-07-24). **Staff** = Forums/Authentik/n8n/Forum admin (**never NocoDB** — deliberate).

## Changing `/api/me`

`/api/me` lives in HQ, not in this repo. Changes to it go through HQ's own review and
deploy process, which is serialized and documented in the fleet's private infrastructure
repo — it is not something this repo can ship on its own.

If you are contributing here and need a change to what `/api/me` returns, open an issue
describing what the extension needs and why, rather than assuming the shape can change.

## Structure

See `README.md` for the file tree. Logic in `src/lib/` (vitest-tested); popup/options are thin wiring; `src/background.ts` is the Phase 3 badge home.

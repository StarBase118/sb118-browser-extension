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
3. Phase 3.1 (list the notifications, not just count them) — not started.
4. **PR #6 (`simplify/pin-chip-cleanup`) is open, not merged** — `/simplify` output on the
   round-1 fix (announcements with no URL no longer render `<a href="#">`, label
   dedupe, combined CSS, shared `scripts/targets.mjs`). Held deliberately: this repo has no
   AI review pipeline, only build-and-test, so `/simplify` output doesn't self-merge here.
   Needs Jordan's read before merging. Worktree `.claude/worktrees/simplify-pass` backs it —
   keep until merged.

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
2. **`GET /api/me`** — read-only endpoint in the **`sb118-megatool`** repo (`src/app/api/me/route.ts`), reads the Authentik/NextAuth session and returns the caller's ship, character (incl. `characters.wiki_url` via `resolveCharacterWikiUrl()` in `src/lib/member-context.ts`), staff flag, **`nav[]`** (added 2026-07-26 — the HQ pages that member may open, built by `src/lib/extension-nav.ts` in megatool), and placeholder notifications/announcements. Classified **member-safe** in the megatool route firewall (`src/__tests__/route-firewall.test.ts`).

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

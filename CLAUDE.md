# SB118 Browser Extension

Browser extension for the StarBase 118 community — launcher + search + personalized dashboard for all SB118 web properties. **SB118-only** (StarBase118 org, ufopsb118 account). No CH/MFC coupling.

**Start here when picking this up:** [`ROADMAP.md`](ROADMAP.md) has phase status + the "pick up here" for Phase 2.

## ⏭ Picking this up (as of 2026-07-26)

Phase 2 is **designed and approved**; one of its four tracks is **shipped**.

- **Spec:** `docs/superpowers/specs/2026-07-26-sb118-extension-phase2-search-design.md`
  (readable companion: `spec-companion-phase2.html` in this repo)

**Phase 2 = four sources, three network calls, one local match.** Destinations (HQ pages) match locally from `nav[]`; wiki, main site and staff forum are fetched in parallel and each group renders as it lands.

| Track | State | Next step |
|---|---|---|
| **1. HQ (megatool)** | ✅ `nav[]` live on `/api/me` (PR #751, prod `2151f3d1`). Forum route ⛔ blocked. | See the blocker below |
| **2. main-site** | ⬜ Not started | Add public `GET /api/search` to `sb118/main-site` returning news + pages + sims (sims reuse `searchSims()` in `src/lib/aria-archive.ts` — already live on Postgres). Shipping it turns three already-wired groups on with **no extension change** |
| **3. extension UI** | ✅ Done | Search box wired to all four sources — see "Search (Phase 2, track 3)" below |
| **4. repo public** | ⬜ Not started | Jordan chose to make this repo public so members can file issues. Audit git history FIRST, then license (MIT), issue templates, README, SECURITY.md, tagged releases |

**⛔ The one blocker — a staff decision, not a code change.** Forum search has to run as the
member who typed the query, so that Discourse itself applies that member's permissions to the
results. The credentials HQ has today cannot do that, and provisioning one that can is a call
for the fleet's staff to make. Until then the forum group is simply absent — everything else
in Phase 2 works without it.

Implementation note for whoever picks this up: the query must be issued **as the calling
member**. Do not query as a privileged account and filter afterwards — that inverts the
permission model and puts the gate in our code instead of Discourse's.

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

**Only two groups return anything today.** Destinations work (megatool PR #751 is live) and
so does the wiki. `news`/`pages`/`sims` and `forum` render as "unavailable" because their
server routes do not exist yet — that is the designed degradation, so **shipping track 2
turns three groups on with no change here**.

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

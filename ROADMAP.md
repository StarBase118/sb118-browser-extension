# SB118 Browser Extension — roadmap & pick-up-here

_Last updated: 2026-07-26._

## ⏭ Pick up here (Phase 2 — search)

**Scope settled 2026-07-26** — Phase 2 covers four sources: HQ destinations, wiki, main site
(news + pages + sim archive), and staff Discourse proxied through HQ. Design spec:
`docs/superpowers/specs/2026-07-26-sb118-extension-phase2-search-design.md`
(readable companion: `spec-companion-phase2.html` in this repo).

**Track 1 (HQ) is DONE and live** — `GET /api/me` now returns `nav[]`, the HQ pages the caller
may open, scoped by their groups (megatool PR #751, prod SHA `2151f3d1`). The extension can
match "vote" locally against that list with no request.

**Track 3 (extension search UI) is DONE** — the popup search box is wired to all four
sources. Destinations match locally against the cached `nav[]`; wiki results are live now;
news/pages/sims and forum render as "unavailable" until their server routes ship, which is
the designed degradation, not a bug.

**Track 2 (main site) is DONE and live** — public `GET /api/search` returns news, pages and
sims. It needed no extension change: the three groups were already wired and simply started
returning results.

**BLOCKED — a staff decision:** staff Discourse search. The query has to run **as the member
who typed it**, so that Discourse applies that member's own permissions to the results. The
credentials HQ has today cannot do that, and provisioning one that can is a call for the
fleet's staff to make.

Until then the forum group is absent and everything else in Phase 2 works. Whoever
implements it: do **not** query as a privileged account and filter afterwards — that moves
the permission check out of Discourse and into our code, which is the wrong place for it.

### Superseded scope notes (kept for context)


**Decision needed from Jordan before planning Phase 2:** which sources does the first
shippable search cover?
1. Wiki only (MediaWiki API — zero new backend, ships fastest)
2. Wiki + main site (small search endpoint on the Payload/Next site)
3. Wiki + main site + staff Discourse (needs a spike to confirm the extension carries the Discourse session, like the HQ spike)

Sim-archive and access-scoped HQ-pages search stay **deferred** (gated on the Aria→Postgres
migration and the `hq-docs-engine`, respectively).

**When restarting:** re-run `/plan` (or the `writing-plans` skill) against the Phase 2 section
of the design spec, scoped to the chosen sources. The search box already renders in the popup
(disabled) — Phase 2 wires it up. Search is **federated**: query each source's own endpoint in
parallel, merge results; access control stays with each system.

### Phase 2 open items
- Wiki search: extension has host permission for `wiki.starbase118.net`; use `api.php?action=query&list=search` (or opensearch). No auth needed.
- Main-site search: needs a small search route on `sb118-megatool`'s sibling Payload/Next main site (`starbase118-site`).
- Staff Discourse search (`staff.starbase118.net/search.json`): **spike first** — confirm a credentialed cross-site fetch from the extension carries the Discourse session cookie (the HQ spike proved it for hq.starbase118.net in Chrome; Discourse uses a different cookie).

## Phase status

| Phase | Scope | State |
|-------|-------|-------|
| **1 — launcher backbone** | Quick-launch, login light, my ship/character, pinned links, staff tiering, `/api/me`, Chromium+Firefox builds | ✅ **Shipped** (extension `main`; `/api/me` live on prod) |
| **2 — search** | Federated unified search, scope toggle; parked add-ons (omnibox, right-click) | 🟡 In progress — HQ `nav[]` + extension UI done; main-site route pending, forum blocked |
| **3 — awareness** | Announcements feed; notification badge (sims first); `POST /api/me/seen` | ⬜ Planned |
| **4 — flavor + staff tools** | Glossary tooltips; staff member-lookup (`/api/staff/lookup`); feedback-queue peek (`/api/staff/feedback-count`) | ⬜ Planned |

## Phase 1 — what shipped (done)

- Extension: MV3 scaffold, dual manifests, Vite build → `dist/chromium` + `dist/firefox`.
- `launcher.ts` (member: HQ/Wiki/Discord/Main site/Sim archive — **Library removed 2026-07-24 per Jordan**; staff: Forums/Authentik/n8n/Forum admin — **no NocoDB**), `session.ts` (direct-fetch `getProfile()`), `pins.ts`, `prefs.ts`.
- Popup: branded design (screenshot-critiqued), login pill, 3-col icon grid, My stuff, Pinned, Announcements (hidden until Phase 3), Staff.
- Options page: manual ship/character fallback + pin management.
- `GET /api/me` on `sb118-megatool` (PRs #713, #714) — session-scoped profile incl. `character.wikiUrl` from `characters.wiki_url`. Live on prod (SHA `cc884ea6`). Member-safe in the route firewall.
- 14 extension unit tests + 5 route tests + firewall test, all green.

## Remaining Phase 1 verification (do on next open if not already)

- [ ] **Firefox two-browser smoke test** — load `dist/firefox`, signed in to HQ, confirm the login light goes green (proves Firefox also carries the session cookie). If grey, add the content-script relay fallback (specified in the Phase 1 plan's Slice 5) as a Firefox-only path; Chrome stays on direct fetch.
- [ ] Confirm the "My character" chip links to the real wiki page in-browser (deployed but not yet eyeballed by a signed-in session).

## Deferred / future

- **In-place feedback panel** — the popup's "Report an issue on this page" opens HQ's report form in a **new tab**, while the wiki, main site and staff forum open the shared panel in place. Injecting it here would need a `scripting` permission plus a host permission for every site the extension could reach; both widen what the extension is allowed to do and both get re-reviewed at store submission. Once the other three triggers ship, the pages the extension uniquely covers are few. To do it later: add `"scripting"` + the missing `www.starbase118.net` host permission and reuse the loader the other triggers share. Do it if members ask, not pre-emptively.
- **Ship wiki URL** — `ship.wikiUrl` in `/api/me` is still `null` (chip → HQ). No clean `ships.wiki_url` source found yet; deriving from ship name is discouraged (see SB118 wiki-scan lesson). Revisit if a source appears.
- **Store distribution** — dedicated SB118 developer accounts for Chrome Web Store / Edge / AMO (not personal). Decide before publishing.
- **Announcements source** — which HQ source `/api/me.announcements` reads (Phase 3).
- **Discord mention counts** — needs a bot/relay for the notification badge (Phase 3).

## Deploy notes

- Extension is greenfield; commit to `main`, build locally.
- `/api/me` lives in HQ, not here. Changes to it go through HQ's own serialized review and
  deploy process; this repo cannot ship them. Open an issue describing what the extension
  needs.

# SB118 Browser Extension — roadmap & pick-up-here

_Last updated: 2026-08-08._

## ⏭ Pick up here (Phase 3 — awareness)

**Phase 2 is COMPLETE and live.** All four search sources return results in the popup:
destinations, wiki, main site (news + pages + sims), and staff Discourse. Nothing in Phase 2
is outstanding.

Next up is **Phase 3 — awareness**: the announcements feed and the notification badge (sims
first), backed by `POST /api/me/seen`. The popup already renders an Announcements section,
hidden behind a flag until this ships.

Two Phase 1 verifications are still open and worth doing first — see
"Remaining Phase 1 verification" below.

## Phase 2 — what shipped (done)

**Scope settled 2026-07-26** — four sources: HQ destinations, wiki, main site (news + pages +
sim archive), and staff Discourse proxied through HQ. Design spec:
`docs/superpowers/specs/2026-07-26-sb118-extension-phase2-search-design.md`
(readable companion: `spec-companion-phase2.html` in this repo).

- **Track 1 (HQ destinations)** — `GET /api/me` returns `nav[]`, the HQ pages the caller may
  open, scoped by their groups (megatool PR #751, prod SHA `2151f3d1`). The extension matches
  "vote" locally against that cached list with no request.
- **Track 3 (extension search UI)** — the popup search box fans out to all four sources
  in parallel and merges the results (extension PR #2).
- **Track 2 (main site)** — public `GET /api/search` on www returns news, pages and sims
  (site PR #103). Needed no extension change; the three groups were already wired.
- **Track 4 (public repo)** — MIT license, SECURITY.md, issue templates, install + privacy
  docs (extension PR #3), so members can file issues.
- **Staff Discourse search** — shipped 2026-08-08 (megatool PR #989 `4d9df681`, infra PR #316
  `94d1ed34`). Staff-only, via `GET /api/search/forum` on HQ.

### How the forum search stays correctly permissioned

This was the last blocker, and the constraint that shaped it is worth keeping in front of
whoever touches it next: **the query runs as the member who typed it**, so Discourse itself
applies that member's category permissions.

Two Discourse credentials, deliberately separate:

1. `SB118_DISCOURSE_ADMIN_API_KEY` (as `system`, read-only) resolves the Authentik `sub` to a
   Discourse username via `GET /u/by-external/oidc/:sub`, cached 1h.
2. `SB118_DISCOURSE_SEARCH_API_KEY` — an **All Users** key, granular-scoped to `search`. The
   query goes out with `Api-Username: <that member>`.

**Do NOT collapse these into one privileged query filtered afterwards.** That moves the
permission check out of Discourse and into our code, and `system` sees private messages.

**The usernames do not match.** Discourse links HQ accounts to Authentik through
`user_associated_accounts` (provider `oidc`), not by name — the forum's usernames came from
the IPB migration, so Authentik `wolf` is Discourse `Jordan_FltAdmlWolf`. Assuming they match
returns 403 for essentially everyone. A member who has never signed into the forum through
Authentik has no association row at all, and correctly gets an `unavailable` forum group
rather than an empty one.

Full writeup: Tech KB → "Discourse usernames are not Authentik usernames"
(`3b6c3f472748819b916eee44e7142542`).

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

## Phase status

| Phase | Scope | State |
|-------|-------|-------|
| **1 — launcher backbone** | Quick-launch, login light, my ship/character, pinned links, staff tiering, `/api/me`, Chromium+Firefox builds | ✅ **Shipped** (extension `main`; `/api/me` live on prod) |
| **2 — search** | Federated unified search over destinations, wiki, main site and staff forum; public repo | ✅ **Shipped 2026-08-08** (all four sources live; parked add-ons — omnibox, right-click — still deferred) |
| **3 — awareness** | Announcements feed; notification badge (sims first); `POST /api/me/seen` | ⬜ Planned — **next up** |
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

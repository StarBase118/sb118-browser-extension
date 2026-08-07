# SB118 Browser Extension — design spec

**Date:** 2026-07-24
**Status:** Design approved, ready for implementation planning
**Owner:** Jordan (ufopsb118 / StarBase118 org)

## Summary

A browser extension for the StarBase 118 community that acts as a single launcher, search box, and personalized dashboard for all of SB118's web properties. It is tiered: every member gets a core set of features, and staff get additional admin tools that light up automatically. Auth is session-aware — the extension never stores or fills passwords; it relies on the existing Authentik SSO session.

The extension is backed by a small set of new HQ endpoints — primarily `/api/me` (the backbone, used by every member), a narrow `POST /api/me/seen` for clearing notification counts, and two staff-only endpoints (`/api/staff/lookup`, `/api/staff/feedback-count`) that land in later phases. Everything else reuses existing site search and content. All are additive and Authentik-protected; only `/api/me/seen` writes, and only to the caller's own last-seen marker.

Scope of this spec is the **whole product**. Delivery is expected to span multiple sessions; a suggested phasing is included as implementation guidance, not as a scope cut.

## Goals

- One-click access to every SB118 property from any page in the browser
- Zero credential handling — safe to distribute to the entire membership
- Personalized shortcuts (your ship, your character) and awareness (notifications, announcements)
- A single search entry point across wiki, sim archive, and (for staff) live forums
- Staff power-tools (admin links, cross-system member lookup, feedback queue) gated behind role, not shipped to members
- Cross-browser: Chromium (Chrome, Edge, Brave) and Firefox. **No Safari** (avoids the Apple developer account requirement).

## Non-goals

- No password storage or autofill of any kind
- No Safari build
- No write actions against SB118 systems from the extension, with **one narrow exception**: advancing the member's own notification `last_seen` marker (`POST /api/me/seen`) so the badge can clear. The extension never posts, moderates, or edits content.
- No cross-project scope — SB118 only; nothing touches CampaignHelp or MFC infrastructure, accounts, or data

## Audience & tiering

- **Member core** — available to any signed-in SB118 member
- **Staff extras** — appear only when `/api/me` reports the user is staff

Tiering in the popup is a UI convenience only. It is **not** a security boundary: each staff-only destination (Discourse, NocoDB, Authentik admin, HQ admin panels, member-lookup endpoint, feedback endpoint) remains independently protected by Authentik. Hiding a link in the popup never grants or withholds actual access.

## Architecture

Two deliverables:

### 1. The extension (Manifest V3)

- **One Chromium codebase** (Chrome/Edge/Brave) plus a **Firefox adaptation**. Use the `browser`/`chrome` namespace via a small polyfill (`webextension-polyfill`) so the two builds share nearly all code. A build step produces both packages.
- **Popup UI** — layout A ("stacked dashboard"): header with login light → search box → quick-launch grid → "My stuff" (ship, character) → pinned links → announcements. Scrollable. Staff section renders below the member content when applicable.
- **Background service worker** — handles session checks, `/api/me` fetch + caching, notification-badge polling, and the omnibox/context-menu handlers (v2 add-ons).
- **Content script** — for glossary/acronym tooltips (v2), injected on SB118 domains (and optionally anywhere).
- **Local storage** (`storage.local`) — pinned links, cached `/api/me` profile (short TTL), and user options (e.g. glossary on/off, tooltip scope).
- **Options page** — manage pinned links, toggle features, and a manual fallback for ship/character if `/api/me` lacks them.

### 2. The HQ endpoints

Four new routes on the megatool, all behind Authentik. Three are `GET` (read-only); one is a narrow `POST` that advances only the caller's own notification `last_seen` marker. `/api/me` is Phase 1 (backbone); `/api/me/seen` lands in Phase 3 with the badge; the two staff routes land in Phase 4 with their UI.

Routes:
- `GET /api/me` — profile + notification counts (Phase 1)
- `POST /api/me/seen` — advance the caller's own last-seen marker for a notification source (Phase 3)
- `GET /api/staff/lookup` — cross-system member lookup, staff-only (Phase 4)
- `GET /api/staff/feedback-count` — open feedback count, staff-only (Phase 4)

#### `GET /api/me` (Phase 1)

- Added to the **megatool** (Next.js 15, `hq.starbase118.net`), behind the existing Authentik auth.
- Reads the caller's Authentik session (same mechanism the megatool already uses for SSO) and returns a JSON profile:

```jsonc
{
  "authenticated": true,
  "writer_id": "A239905NR1",
  "displayName": "Wolf",
  "isStaff": true,
  "staffRoles": ["ec", "training"],           // drives which staff tools show
  "ship": {
    "name": "USS Example",
    "wikiUrl": "https://wiki.starbase118.net/...",
    "forumUrl": "https://staff.starbase118.net/c/..."   // staff-relevant
  },
  "character": {
    "name": "…",
    "wikiUrl": "https://wiki.starbase118.net/..."
  },
  "notifications": {                          // per source: unread count AND the current latest marker
    "sims":    { "count": 3, "latest": "sim_88123" },   // latest = what POST /api/me/seen would advance to
    "discord": { "count": 0, "latest": null },
    "forum":   { "count": 2, "latest": "2026-07-24T10:00:00Z" }  // forum only populated for staff
  },
  "announcements": [
    { "title": "Awards ceremony…", "url": "…", "date": "2026-07-20" }
  ]
}
```

- **Unauthenticated** callers get `401` (the login light reads this as "signed out").
- **Source of truth:** `writer_id` is the cross-system join key (never `writer_ids.member_id`, which is junk). Ship/character resolve from NocoDB members; notification counts from the relevant systems (see per-feature notes).
- **Announcements — deferred field with a safe default.** The canonical announcements source is not yet decided (see Open questions). Until it is, `/api/me` returns `announcements: []` and the popup hides the announcements section when the array is empty. Choosing the source and populating this field is Phase 3 work; nothing else in `/api/me` blocks on it.
- **CORS:** the endpoint must allow credentialed requests from the extension origin(s). Extension IDs are stable once published; allow the published IDs plus a dev ID during development. The same CORS policy applies to the two staff endpoints below.

#### `POST /api/me/seen` (Phase 3)

- **Auth:** Authentik-protected; acts only on the caller's own writer_id (derived from the session, never from the request body).
- **Input:** `{ "source": "sims", "value": "<marker>" }`. `source` is one of the known notification sources (`sims`, `discord`, `forum`). `value` is **optional**: the marker to advance to (typically the `latest` value `/api/me` reported for that source). **If `value` is omitted, the server marks the source's current latest as seen** — the common case, and it removes any dependency on the client knowing the marker. `/api/me.notifications.<source>.latest` supplies the value when the client does want to pass one explicitly.
- **Idempotency:** advancing to an already-seen or older value is a no-op — the marker only moves forward. Safe to call repeatedly.
- **Output:** `{ "source": "sims", "last_seen": "<stored value>" }` (`200`). `400` on unknown `source`; `401` if unauthenticated.
- **CSRF:** because it is a state-changing request, it requires the same credentialed same-site path as `/api/me` (via the content-script relay) and a CSRF guard consistent with the megatool's existing conventions.

#### `GET /api/staff/lookup?q=<term>` (Phase 4)

- **Auth:** Authentik-protected; additionally returns `403` unless `isStaff`. Never trust the popup's tiering — enforce the role here.
- **Input:** `q` — a name, email, or writer_id. The handler accounts for name variants and searches by email / writer_id per the search-reconciliation rules; it does not require an exact match.
- **Output:** a unified identity view (the `sb118-identity-resolver` logic behind an endpoint):

```jsonc
{
  "matches": [
    {
      "writer_id": "A239905NR1",
      "displayName": "…",
      "systems": {
        "hq": { "found": true, "url": "…" },
        "forum": { "found": true, "url": "…" },
        "wiki": { "found": false },
        "authentik": { "found": true }
      }
    }
  ]
}
```

- **Privacy:** follows existing donor-email / member-PII rules — no email is surfaced beyond what staff are already entitled to see. Empty `matches` on no result (not an error).

#### `GET /api/staff/feedback-count` (Phase 4)

- **Auth:** Authentik-protected; `403` unless `isStaff`.
- **Output:** `{ "open": 7, "url": "https://hq.starbase118.net/feedback" }` — count of open `bug_reports` rows in NocoDB plus the deep link. Read-only.

### Session access mechanism (the foundational risk)

The whole personalized layer depends on the extension being able to call `/api/me` **as the signed-in member**. This is not guaranteed by default and must be proven before Phase 1 build:

- **The SameSite gotcha.** A `fetch()` from the extension's own origin (`chrome-extension://…` / `moz-extension://…`) to `hq.starbase118.net` is a **cross-site** request. Authentik's session cookie is almost certainly `SameSite=Lax` (or `Strict`), and Lax/Strict cookies are **not** sent on cross-site subresource requests like `fetch`. So a naive `fetch('/api/me', {credentials:'include'})` from the popup or service worker may arrive **without** the session cookie and get a `401`, even when the user is logged in.

- **Primary approach — content-script relay (cookies always flow).** Rather than fetch cross-site, run the `/api/me` request **inside the page context of an HQ tab** where it is same-site and cookies are sent normally:
  - If an HQ tab is open, inject a content script that fetches `/api/me` same-origin and messages the result back to the service worker.
  - If no HQ tab is open, the service worker opens a hidden/offscreen request path or a background HQ document to perform the same-origin fetch. (Chromium: offscreen document or a short-lived tab; Firefox: a background page fetch. The exact mechanism is validated in the spike.)
  This keeps everything on the user's real Authentik session with no cookie changes.

- **Fallback / alternative — relax the cookie.** If the relay proves too costly, an alternative is issuing a dedicated, `SameSite=None; Secure; HttpOnly` cookie **scoped only to `/api/me`** (not the main Authentik session), or a short-lived token the extension stores. This has a larger security surface and is **not** preferred; it is the backstop only.

- **Phase 1 spike (required first task).** Before building anything personalized, prove that `/api/me` can be read with the live Authentik session from **both** a Chromium and a Firefox extension context. The spike's outcome picks the mechanism above. If neither the relay nor an acceptable cookie approach works, the personalized features fall back to the manual ship/character config and the extension still ships as a static launcher + search tool.

### Data flow (typical popup open)

1. Popup opens → background worker checks for a cached `/api/me` (fresh within TTL) → renders immediately if present.
2. Worker fetches `/api/me` (credentialed) in the background → updates the popup and cache.
3. `401` → render "signed out" state with a one-click login button (opens Authentik login in a new tab).
4. Search, launch, and pinned-link actions open the target property in a new tab; no `/api/me` round-trip needed.

## Feature detail

### Member core

1. **Quick-launch popup** — buttons for HQ, Wiki, Discord, Main site, Library, Sim archive. (Forums is **not** here — it's staff-only now.) Links are static, defined in a config file so they're easy to update.
2. **Login status light** — green = `/api/me` returned 200; grey/red = 401. Clicking when signed out opens the Authentik login.
3. **My ship** — one click to the ship's wiki page (and, for staff, its forum category). Populated from `/api/me`.
4. **My character** — one click to the character's wiki bio page. Populated from `/api/me`.
5. **Personal pinned links** — user pins any URL (wiki page, thread, external) for one-click return. Stored in `storage.local`. Managed from the popup and the options page.
6. **Unified search** — one box over a **federated** search: the extension queries each corpus's own search endpoint in parallel and merges the results, grouped by source. It is **not** a central index. This is deliberate for access control — each system answers for itself using the caller's session/permissions, so results can never include content the user isn't entitled to see (critical for access-scoped HQ pages). Sources, each switching on as it gets a searchable, access-aware endpoint:
   - **Wiki** — MediaWiki `api.php?action=query&list=search` (or opensearch) against wiki.starbase118.net. **Available today; the first source shipped.**
   - **Main site** — the Payload/Next `www.starbase118.net` content (chiefly news posts). Small corpus; needs a small search endpoint on the site (Payload query or a dedicated route). Modest build.
   - **Sim archive** — the Aria/Postgres archive search. **Gated on the Aria→Postgres migration** exposing a full-text search endpoint over the sim corpus; omitted until it lands.
   - **HQ pages the user has access to** — group-scoped documentation. **The biggest dependency:** requires the `hq-docs-engine` (still in brainstorm, not built) to expose a **permission-aware** search that filters to the caller's Authentik groups server-side. This source lands only once that engine and its access-scoped search exist. Until then it is simply absent from the results.
   - **Public forum archive** — the read-only IPB static archive (search via its index if available; otherwise a scoped site query link).
   - **Staff:** live Discourse search (`staff.starbase118.net/search.json`) is added as an extra source when `isStaff`.
   - A scope toggle lets the user narrow to one source. Because it is federated, the box's coverage grows over time without a re-architecture — each new access-aware endpoint is just another source to merge.

### Member awareness & flavor

7. **Notification badge** — a count on the toolbar icon. Sources, in priority order: new sims on your ship, Discord mentions, (staff) forum notifications. Counts come from `/api/me.notifications`, refreshed by the background worker on an alarm (e.g. every 10–15 min) and on popup open.

   **Count semantics (defined so implementations don't diverge):**
   - **"New" baseline** — each notification source has a `last_seen` marker: for sims, the id/timestamp of the most recent sim the member has already seen on their ship. The **server** owns the authoritative "latest" value (sims come from the Aria/Postgres archive) and returns it as `/api/me.notifications.sims.latest`; the **`last_seen` marker is stored per member server-side** in the megatool so the count is consistent across the member's devices/browsers. `/api/me.notifications.sims.count` = number of sims on the member's ship newer than their stored `last_seen`.
   - **Reset / clear** — the badge count for a source clears when the member views that source: opening "My ship" (or the sims view) advances `last_seen` to the latest, zeroing the sim count. Clicking the badge/notification also advances it. The extension calls a tiny write (`POST /api/me/seen`) to advance the marker; this is the one exception to "no write actions," and it only touches the member's own last-seen state.
   - **Persistence** — because `last_seen` lives server-side, reinstalling the extension or switching browsers does not resurrect already-seen counts.
   - **Discord mentions** require a bot/relay source (see Open questions); if unavailable at build time, that component of the badge is simply omitted. Forum notifications (staff) use Discourse's own unread state.
8. **Glossary / acronym tooltips** — hover an SB118 term (rank, acronym, species, etc.) and get a definition popup. Backed by a **static term dictionary** shipped with the extension (compiled from the wiki glossary), so it needs no live backend. Injected by the content script. **Scope decision:** by default the content script runs **only on SB118 domains** (the declared host permissions), which also keeps store-review risk low. Running it on all sites is opt-in: the options page requests a broad host permission via the browser's `optional_host_permissions` / runtime permission prompt only if the user explicitly turns on "tooltips everywhere." The default bundle never requests all-URLs access.
9. **Latest announcements** — recent HQ/fleet announcements in the popup, from `/api/me.announcements`.

### Staff extras (render only when `isStaff`)

10. **Forums** — quick link to the staff Discourse (`staff.starbase118.net`). (Moved here from member core.)
11. **Admin quick-links** — Authentik admin, n8n, Discourse admin, HQ admin panels. (NocoDB is deliberately **not** linked.) Which links show can key off `staffRoles`.
12. **Member lookup** — type a name / email / writer_id → resolve across HQ members, forums, wiki, Authentik. Backed by a **staff-only lookup endpoint** that wraps the existing identity-resolution logic (the `sb118-identity-resolver` capability), Authentik-protected. Never displays donor/member email in a way that violates the existing privacy rules; follows the search-reconciliation conventions (search by email/writer_id, account for name variants).
13. **Feedback / bug queue peek** — count of open items + a jump to the HQ feedback queue (`bug_reports` in NocoDB). Count via a small staff-only endpoint.

### Parked add-ons (easy, low priority)

- **Address-bar search** — type `sb` + space in the URL bar, then a query → SB118 search (uses the omnibox API).
- **Right-click "Search SB118 wiki for…"** — context-menu item on selected text.

## Cross-browser notes

- Manifest V3 for both. Use `webextension-polyfill` to normalize the API surface.
- Firefox differences to watch: background as an event page vs service worker (Firefox supports MV3 background scripts with some differences), `browser_specific_settings.gecko.id` required in the manifest, and Firefox's stricter handling of host permissions. The build step emits a Chromium manifest and a Firefox manifest from a shared source.
- Distribution: Chrome Web Store + Edge Add-ons (same package) and Firefox AMO. Brave uses the Chrome Web Store package.

## Security & privacy

- **No passwords, ever.** Session-cookie SSO only.
- `/api/me` and all staff endpoints are Authentik-protected server-side; the popup's tiering is cosmetic.
- **Host permissions** limited to SB118 domains by default (for API calls and the glossary content script). All-URLs access for "tooltips everywhere" is never in the default bundle — it is requested at runtime via `optional_host_permissions` only when the user opts in.
- **CORS** allows only the extension origins (published IDs + dev ID), credentialed.
- **No secrets in the extension bundle** — the extension holds no API keys; it authenticates purely via the user's own session cookie.
- **Member email / PII** never surfaced by member lookup beyond what staff are already entitled to see; follows existing donor-email and identity privacy rules.
- **Backup/rollback:** the new server surface is additive. The only write (`POST /api/me/seen`) touches a single per-member last-seen marker — no destructive changes to shared data. Rollback = revert the megatool PR; the extension degrades gracefully (falls back to manual ship/character config and static launcher) if the endpoints are unavailable.

## Separation (MFC / SB118 / CH)

- New repo lives under the **`ufopsb118` / `StarBase118`** org.
- Uses **SB118** Authentik, **SB118** infra, **SB118** Cloudflare zone only.
- No shared credentials, databases, or services with CH or MFC. This is an SB118-only project end to end.

## Planning approach

This document is the **product spec** — it intentionally covers the whole product. It is deliberately too broad to turn into a single implementation plan. **Each phase below gets its own implementation plan, written and executed separately, Phase 1 first.** The first plan covers only the session-access spike + Phase 1 backbone; later phases are planned when their external dependencies (Aria migration, hq-docs-engine, Discord relay, store accounts) are settled. This keeps every plan tightly scoped and verifiable.

## Suggested phasing (implementation guidance, not a scope cut)

**Phase 1 — launcher + backbone**
- **Session-access spike first** — prove `/api/me` reads the live Authentik session from both Chromium and Firefox extension contexts (see "Session access mechanism"). Everything personalized depends on this.
- `/api/me` endpoint in the megatool
- Extension skeleton (MV3, popup layout A, background worker, storage)
- Quick-launch, login light, my ship, my character, pinned links, staff tiering
- Chromium build; Firefox build

**Phase 2 — search**
- Federated unified search, scope toggle. Ship wiki first (available today), then add main-site and public-forum-archive sources; staff Discourse when `isStaff`.
- Sim-archive and access-scoped HQ-pages sources are added later as their endpoints land (Aria migration; hq-docs-engine) — the federated design absorbs them without rework.
- Parked add-ons: omnibox, right-click search

**Phase 3 — awareness**
- Announcements feed
- Notification badge (sims first; Discord/forum as sources become available)

**Phase 4 — flavor + staff power-tools**
- Glossary tooltips (static dictionary + content script + options)
- Member lookup endpoint + UI
- Feedback-queue peek endpoint + UI

## Open questions

1. **Sim archive search** — depends on the Aria→Postgres migration status. If the archive search endpoint isn't ready, omit that source in Phase 2 and add it when it lands.
2. **Discord mention counts** — needs a bot/relay that can report per-user unread mentions. If there's no clean source, the badge uses sims (+ staff forum) only. Decide during Phase 3.
3. **Announcements source** — confirm the canonical HQ/fleet announcements source `/api/me` should read (existing HQ announcements table vs a feed vs Sendy comms).
4. **Glossary dictionary refresh** — the static term dictionary is compiled from the wiki glossary. Decide cadence for regenerating it (manual, or a periodic build script).
5. **Distribution ownership** — which store accounts (Chrome Web Store, Edge, AMO) publish under. Likely a dedicated SB118 developer account, not personal.
6. **Access-scoped HQ-pages search** — depends on the `hq-docs-engine` being built and exposing a permission-aware search endpoint. Until that lands, the search box simply omits HQ pages as a source; adding it later is just another federated source, no rework.

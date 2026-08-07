# SB118 Browser Extension — Phase 2 design: federated search

**Date:** 2026-07-26
**Status:** Approved by Jordan (design), pending spec review
**Supersedes:** the four-bullet Phase 2 sketch in `2026-07-24-sb118-browser-extension-design.md`

## Summary

Phase 2 turns the popup's disabled search box into a working federated search across
four sources: HQ page destinations, the wiki, the main site (news, pages, sim archive),
and the staff Discourse forum. Results are grouped by source. Destinations match locally
and appear instantly; the other groups render as their requests return.

Phase 2 also flips the repository public and gives it the full open-source surface —
issue templates, README, docs, releases — so members can install it and report problems.

## Goals

- One box that answers both "take me to the voting page" and "find me the thing about X."
- Search works signed out for public sources; private sources appear only for those entitled to them.
- No result a member cannot access is ever shown to them.
- Adding a fifth source later requires no rework of the client.

## Non-goals

- Announcements feed, notification badges, and the open-vote badge — all Phase 3.
  (The open-vote badge is explicitly the first slice of Phase 3, decided this session.)
- Full-text search of HQ *content* (docs/pages bodies) — still gated on `hq-docs-engine`.
  Phase 2 covers HQ *destinations* only.
- Omnibox (address-bar keyword) and right-click search — parked; see "Rejected alternatives."

## Architecture

Four sources, three network calls, one local match.

```
                 ┌──────────────────────────────────────────┐
   type "vote"   │  popup search (debounce 200ms)           │
        │        └──────────────────────────────────────────┘
        │                        │
        ├── local ──> Destinations   (nav[] cached from /api/me — instant, no request)
        │
        ├── fetch ──> wiki.starbase118.net/api.php        (public, no auth)
        │
        ├── fetch ──> www.starbase118.net/api/search      (public — posts, pages, sims)
        │
        └── fetch ──> hq.starbase118.net/api/search/forum (session-scoped, staff only)
```

Each of the three fetches renders into its own group the moment it resolves. There is no
barrier: a slow forum query never delays wiki results.

### Why not a single HQ gateway

Considered and rejected. Routing everything through HQ would put a hop in front of content
that is already public, force all-at-once rendering (the response can only be as fast as the
slowest source), and — decisively — return nothing at all to signed-out users, since HQ
requires a session. Public wiki and sim search must keep working when signed out.

### Why Discourse goes through HQ anyway

Discourse is the one private source, and it is proxied rather than fetched directly:

- **Enforcement, not concealment.** A server route can return an empty result for a
  non-staff caller. A client-side `if (isStaff)` is a UI decision that a modified client
  can skip. Discourse would still enforce its own permissions, but HQ should not be
  handing out a query path that depends on that being the only line of defense.
- **Browser-independent.** A direct fetch would depend on the Discourse session cookie
  riding along on a cross-site request, whose behavior differs between Chrome and Firefox.
  The proxy sidesteps the question entirely — no cookie spike required.
- **HQ can already reach the forum.** HQ talks to Discourse today for other features, so the
  connection, its credentials and its network path are established and maintained in one
  place. Adding a search route reuses that rather than standing up a second integration
  inside a client that ships to members' browsers.

**Correction on the record:** an earlier reading of this held that Discourse's missing CORS
headers ruled out a direct extension fetch. That was wrong — an MV3 extension with the host
in `host_permissions` bypasses CORS, which is how the Phase 1 fetch to `/api/me` worked.
CORS is not the reason for the proxy; the three reasons above are.

## Server changes

### 1. `GET /api/me` gains `nav[]` (megatool)

```ts
nav: Array<{ label: string; path: string; category: string }>
```

Built from `getNavPaths()` (`src/components/layout/nav-paths.ts`), filtered to the paths the
caller's groups permit.

**The filter must reuse the same path-matching logic the middleware uses against
`ROUTE_GROUPS`** (`src/types/groups.ts`) — not a fresh lookup. HQ's route authorization is
default-open, and a trailing-slash mismatch in a hand-rolled matcher has previously caused
routes to be treated as ungated. A second implementation of that matching is the most likely
way this feature leaks a page. If the existing matcher is not currently exported in a usable
form, extract it — do not copy it.

Feature-flag behavior comes free: `getNavPaths()` already filters flag-gated entries, so a
dark feature never appears in anyone's `nav[]`.

The extension caches `nav[]` in extension storage and refreshes it whenever `/api/me` is
called (popup open).

**The cache is cleared whenever `/api/me` does not return an authenticated profile** — a 401,
a network failure that resolves to signed-out, or an explicit sign-out. Destinations render
only from a cache written by a successful authenticated response in the current session. This
matters because the cache outlives the popup: without the clear, signing out (or a session
expiring) would leave a signed-out user still seeing, and matching against, the page list from
the previous session. Group membership can also change between sessions, so the cache is
replaced wholesale on each successful `/api/me`, never merged.

A stale-but-authenticated entry is harmless — the destination link either still resolves or
lands on HQ's own not-authorized handling.

### 2. `GET /api/search/forum?q=` (megatool, new)

- **Access:** signed-in staff only. Non-staff and unauthenticated callers receive
  `200 { groups: [] }` — the same envelope as every other search route, with no forum group
  present. Not a 403, so the client needs no special case.

  **Two independent layers, deliberately:** the client skips the request entirely when
  `/api/me` says the caller is not staff (saves a round trip and keeps the group out of the
  UI), and the server returns an empty group regardless of what any client does. The client
  behavior is an optimization; the server behavior is the guarantee. Neither is sufficient
  alone and the spec requires both.
- **Identity mapping:** resolve the caller to their Discourse account by email. Both systems
  provision accounts from Authentik, so emails match. Cache the member→username mapping
  (in-process, same 5-minute TTL pattern as `discourse-perms.ts`). If no Discourse account
  matches, return an empty result rather than an error.
- **Query:** `GET {base}/search.json?q=...` issued **as the calling member**, so Discourse
  itself scopes results to the categories that member can read. Never query as a privileged
  account and filter afterwards — that moves the permission check out of Discourse and into
  our code, which is the wrong place for it.
- **Rate limits:** Discourse throttles search. On 429, return the group as unavailable —
  do not retry within a request.
- **Route firewall:** classify as staff-only, and add a firewall test asserting that, in the
  same style as the `/api/me` member-safe test from Phase 1.

### 3. `GET /api/search?q=` (main-site, new)

Public. Returns three groups:

- **posts** — Payload `Posts` collection (Community News)
- **pages** — Payload `Pages` collection
- **sims** — the existing `searchSims()` in `src/lib/aria-archive.ts`

The sim archive is live on Postgres and already backs `/sims/search`. The original design
deferred sims pending the Aria migration; that deferral is stale as of this spec.

Sets `Access-Control-Allow-Origin: *`. The data is public and the response carries no
credentials, so the wildcard is appropriate. Extensions do not strictly need it given host
permissions; it is one line that removes an entire category of browser-difference debugging.

### Shared result shape

Every source normalizes to:

```ts
interface SearchHit {
  source: 'destination' | 'wiki' | 'news' | 'pages' | 'sims' | 'forum'
  title: string
  snippet: string | null   // destinations have none
  url: string
}
```

Both server routes return groups rather than a flat list, in a shared envelope:

```ts
interface SearchResponse {
  groups: Array<{ source: SearchHit['source']; hits: SearchHit[]; seeAllUrl: string | null }>
}
```

`/api/search` (main-site) returns three groups (`news`, `pages`, `sims`); `/api/search/forum`
returns one (`forum`) for an entitled caller and **zero groups** for anyone else. A group
present with zero hits means "searched, nothing found"; a group absent means "not applicable
to this caller." Both server routes use this envelope — there is no second response shape.

`seeAllUrl` per source:

| source | target |
|---|---|
| `wiki` | `wiki.starbase118.net/index.php?search=<q>` |
| `news`, `pages` | `www.starbase118.net/search?q=<q>` (the main site's own search page) |
| `sims` | `www.starbase118.net/sims/search/?q=<q>` (exists today) |
| `forum` | `staff.starbase118.net/search?q=<q>` |
| `destination` | none — `null` (the full list is already local and short) |

If the main site has no user-facing `/search` page at implementation time, `news` and `pages`
carry `null` rather than a link to a 404; adding the page later is a one-line change.

Normalization happens per-source in the extension for wiki (which returns HTML-ish snippets
needing stripping), and server-side for the HQ and main-site routes. The popup renders one
component for all of them.

## Client behavior

- **Trigger:** typing in the popup search box. `Ctrl+Shift+S` (`Cmd+Shift+S` on macOS) opens
  the popup with the box focused, via the `commands` API `_execute_action` with a suggested key.
- **Minimum query:** destinations match from the first character (the list is local and small).
  The three network sources fire only at **2 or more non-whitespace characters**; below that
  their groups are absent, not empty, so a single keystroke never triggers three requests.
  Queries are trimmed before comparison, and a query that trims to empty restores the launcher.
- **Debounce:** 200ms. Each new keystroke aborts in-flight requests (`AbortController`) so a
  slow response for an older query can never overwrite newer results.
- **Timeout:** 5s per source.
- **Layout:** search replaces the popup body while the query is non-empty; clearing it restores
  the normal launcher. Destinations render first and always sit at the top.
- **Caps:** 5 hits per group, each group footed by a "see all" link into that system's own
  search page.
- **Keyboard:** Enter opens the top hit, arrows move the selection, Escape clears. All hits
  open in a new tab via the existing `openUrl()` helper.
- **Signed out:** wiki, news, pages and sims all still work. Destinations and forum groups are
  absent, replaced by a single quiet sign-in line.
- **Per-source failure is isolated:** a failed or timed-out source renders as
  "<source> unavailable" within its own group. The others are unaffected. A search where every
  source fails is visibly a failure, not an empty result.

## Repository, distribution and docs

The repo (`StarBase118/sb118-browser-extension`) **flips from private to public** as part of
this phase, so members can install it and file issues.

**Before flipping public**, audit the full git history for anything that should not be
published — the repo is greenfield and expected to be clean, but the check is not optional and
happens before the visibility change, not after.

Then:

- **Issues on, with two templates:** bug report and feature suggestion, both as YAML forms so
  reports arrive with the browser, version, and steps already filled in. A template chooser
  config routes "how do I use this" questions to Discord rather than the tracker.
- **README** covering what the extension does, install from the stores once published,
  install-unpacked instructions for the interim, a screenshot, and how to report a problem.
- **Repo metadata:** description, topics, and homepage pointing at starbase118.net.
- **SECURITY.md** with private vulnerability reporting enabled, so a session-related bug has
  somewhere to go that is not a public issue.
- **LICENSE — MIT.** Decided, not deferred: a public repo needs a license at the moment it
  goes public, and MIT is the conventional choice for a browser extension meant to be
  installed and read by its own community. Jordan can override before the flip, but
  implementation should not wait on it.
- **Versioning:** semver, with the manifest version as the source of truth. Tagged releases
  carry the built Chromium and Firefox zips, attached by the existing CI workflow.
- **Docs:** `docs/` gets an install guide, a "what each source searches" page, and a privacy
  note stating plainly what the extension reads and that it sends nothing anywhere except the
  four SB118 systems it queries.

**Store distribution stays an open decision** (see below) — the README covers unpacked install
until it is resolved.

## Testing

**Server (megatool):**

- `/api/me` returns only the pages a given member's groups permit — including a plain member
  with no staff groups, which is the case that would actually leak.
- `nav[]` respects feature flags (a dark route never appears).
- `/api/search/forum` returns `{ groups: [] }` for a non-staff caller and for an
  unauthenticated one — asserted against the route directly, not through the client, since the
  client's own suppression must not be what makes this pass.
- Route-firewall test asserting the forum route is staff-classified.
- Discourse client: query is issued with `Api-Username` set to the member, never `system`.

**Server (main-site):**

- `/api/search` returns the three groups with the shared shape; empty query is a 400.

**Extension:**

- Destination filtering: matching, ranking, and the cap.
- Result normalization per source, including wiki snippet stripping.
- Debounce and abort: an older in-flight response cannot overwrite a newer query's results.
- Per-source failure isolation: one rejected source leaves the others rendered.
- Signed-out rendering omits destinations and forum.

**Manual:**

- Two-browser smoke test in Chrome and Firefox, signed in and signed out. This also clears the
  outstanding Phase 1 Firefox check (does the login light go green in Firefox), which has been
  open since 2026-07-24.

## Deployment

Two production surfaces, deployed independently:

- **HQ** (`/api/me` nav, forum search): ships through HQ's own serialized deploy process.
  Verify after deploy that `/api/me` still returns 401 unauthenticated and that the forum
  route returns `{ groups: [] }` to an unauthenticated caller.
- **main-site** (`/api/search`): its own deploy path; verify the route live before wiring the
  extension group to it.
- **extension:** commits to `main`, built locally, released by tag.

Ship the server routes first. The extension degrades to "source unavailable" against a route
that does not exist yet, so there is no ordering hazard in either direction.

### Workstreams

This spec covers four independently shippable tracks, and the implementation plan should keep
them separate rather than interleaving them:

1. **megatool** — `nav[]` on `/api/me`, the forum search route.
2. **main-site** — the public search route.
3. **extension** — search UI, per-source clients, keyboard shortcut, failure isolation.
4. **repo-public prep** — history audit, license, templates, README, docs, release packaging.

Tracks 1 and 2 are prerequisites for the corresponding groups in track 3, but are independent
of each other. Track 4 shares no code with the others and can run at any point.

**Phase 2 is a label for this body of work, not a release bundle.** Nothing waits for
everything else to be finished. Each track ships when its own acceptance criteria are met:

1. **megatool** — `/api/me` returns `nav[]` correctly scoped for a plain member and for staff;
   `/api/search/forum` returns results for a staff caller and `{ groups: [] }` for everyone
   else; route-firewall and permission tests green; deployed and verified live.
2. **main-site** — `/api/search` returns the three groups in the shared envelope; deployed and
   verified live.
3. **extension** — search works against whichever routes exist, degrading per-source for those
   that do not; keyboard shortcut works; two-browser smoke test passes signed in and out.
4. **repo-public prep** — history audit clean, license and templates in place, README covers
   install, repo is public and a test issue can be filed.

**Each track gets its own implementation plan.** A single plan spanning all four would mix
three codebases and a repo-administration task with no shared code, no shared tests, and no
shared deploy path. Track 1 is the natural first plan: it is the prerequisite for the most
valuable group (destinations) and carries the only real access-control risk in the phase.

**Rollback:** revert the PR and redeploy the prior SHA. The extension's per-source isolation
means a reverted server route degrades one group rather than breaking search.

## Open decisions

1. **Store distribution accounts** — Chrome Web Store, Edge, and AMO listings should publish
   under a dedicated SB118 developer account, not Jordan's personal one. Carried over from
   Phase 1 and still unresolved; blocks store publication but not the public repo or the
   unpacked install path.
2. **Ship wiki URL** — `ship.wikiUrl` in `/api/me` remains `null`; unrelated to search but
   still open from Phase 1.

## Rejected alternatives

- **HQ as single gateway for all four sources** — kills signed-out search, adds a hop to public
  content, and forces all-at-once rendering. See "Architecture."
- **Extension fetches Discourse directly** — viable in Chrome, but makes the staff gate a
  client-side decision and makes Firefox behavior an open question. See "Why Discourse goes
  through HQ anyway."
- **Address-bar keyword (omnibox)** — the API can only render plain text rows, so it cannot
  group by source or show icons. It would mean maintaining a second, worse rendering path.
  The keyboard shortcut delivers most of the speed benefit at a fraction of the cost.
- **Full-text HQ content search** — still gated on `hq-docs-engine`. The federated design
  absorbs it later as one more source.

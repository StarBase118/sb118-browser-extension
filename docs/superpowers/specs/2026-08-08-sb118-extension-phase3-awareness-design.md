# SB118 Browser Extension — Phase 3 (awareness) design

_Written 2026-08-08. Scope confirmed by Jordan the same day._

Phase 3 is the first thing that makes the extension worth leaving installed. Phases 1 and 2
make it a faster way to reach pages you were going to reach anyway; a badge is what makes
someone open the popup unprompted.

## Scope

A toolbar badge with a count, fed by three sources, each independently switchable off:

| Source | What counts as new | Where it comes from |
|---|---|---|
| **Announcements** | A human post in Discord `📣announcements` | Discord REST, read by the `ClaudeCode` bot, server-side |
| **Sims** | A sim on any ship the member currently has a placement on, that they did not write | HQ Postgres via `listShipSims()` |
| **News** | An item in the Community News feed | `https://www.starbase118.net/feed` (RSS) |

Out of scope, deliberately: Discord mention counts (needs a per-user relay that does not
exist), forum activity, and any push/desktop notification. The badge is the only alert
surface.

## The shape of it

**One new HQ endpoint. All state lives in the browser.**

```
                 ┌──────────────────────────────┐
  every 15 min   │  extension service worker    │
  (chrome.alarms)│  src/background.ts           │
                 └──────────────┬───────────────┘
                                │ GET /api/me/notifications?sources=…
                                ▼
                 ┌──────────────────────────────┐
                 │  HQ (megatool)               │
                 │  aggregates 3 sources        │
                 └───┬──────────┬───────────┬───┘
        Discord REST │          │ Postgres  │ RSS
        (bot token)  │          │ (sims)    │ (public)
                     ▼          ▼           ▼
                 #announcements  aria     www/feed
```

The endpoint returns **recent items**, not counts. The extension holds a per-source
`lastSeen` timestamp in `storage.local` and counts locally how many returned items are newer.

### Why the aggregation is server-side

The Discord bot token decides it. An extension's code is public — anyone who installs it can
read it — so a bot token can never ship inside one. Sims need HQ's database regardless. Only
RSS could have gone client-side, and splitting one source out buys nothing but a second
failure surface.

### Why there is no `POST /api/me/seen`

The original Phase 1 design (`2026-07-24-sb118-browser-extension-design.md` §"POST
/api/me/seen") put last-seen markers in HQ's database. **That route is cancelled.** Returning
items instead of counts means the server needs no per-member state at all: no new table, no
mutating route, no CSRF surface, no migration.

The trade, stated plainly: **badge state is per-browser and does not sync.** Read the same
announcement on your laptop and your desktop badge still shows it. For a launcher extension
that is acceptable and arguably correct — the badge is a property of "this browser I am
sitting at", not of the member. If sync is ever wanted, the endpoint does not change; a
`seen` route gets added alongside and the client prefers the server's marker.

## `GET /api/me/notifications`

**Auth:** Authentik session required. Not staff-gated — every member gets this.
Unauthenticated returns `401` with `{ "sources": {} }`, matching how `/api/search/forum`
returns an empty envelope rather than an error body.

**Gate placement:** `/api/me/*` is outside the middleware matcher (which covers pages and
`/api/v1/*` only), so the handler does its own `auth()` check, exactly as `/api/me` and
`/api/search/forum` do. Add the path to `MEMBER_SAFE_ROUTES` in
`src/__tests__/route-firewall.test.ts` — the firewall test fails the build otherwise, which
is how the `/api/search/forum` omission was caught.

**Query params**

- `sources` — comma-separated subset of `announcements,sims,news`. Omitted means all three.
  An unknown name is ignored rather than a `400`, so an older extension asking for a source
  we later remove keeps working.
- `limit` — items per source, default 20, max 50.

**Response** (`200`)

```jsonc
{
  "sources": {
    "announcements": {
      "items": [
        {
          "id": "1398…",                        // stable per source
          "title": "Sal Taybrim has been promoted to Rear Admiral",
          "url": "https://discord.com/channels/201534052631576579/374351696031252480/1398…",
          "at": "2026-07-28T12:48:15.025Z"      // ISO 8601, UTC
        }
      ],
      "unavailable": false
    },
    "sims":  { "items": [ … ], "unavailable": false },
    "news":  { "items": [ … ], "unavailable": false }
  }
}
```

Every source returns the same item shape. Items are newest-first.

**`unavailable` is load-bearing.** A source that fails or times out returns
`{ "items": [], "unavailable": true }` — never a bare empty list. An empty list means "we
looked and there is nothing new"; `unavailable` means "we could not look." Collapsing the two
makes a Discord outage read as a quiet fleet. This is the same rule Phase 2's search groups
follow, and the same mistake the main-site search route caught mid-build.

**CORS:** identical to `/api/me` — allow the extension origin, `Access-Control-Allow-Credentials: true`, `Cache-Control: no-store`, `OPTIONS` handler.

**Timeout:** 4s per source, fetched in parallel. One slow source must not hold the other two.

### Source 1 — announcements

Discord REST: `GET /channels/374351696031252480/messages?limit={limit}` with
`Authorization: Bot $SB118_DISCORD_BOT_TOKEN`. Guild `201534052631576579`.

**The filter is the whole feature.** Measured against the last 50 messages in that channel on
2026-08-08:

| Kind | Count |
|---|---|
| Webhook posts (Dyno 29, Claude Code 7, Claude 3) | 39 |
| Bot user posts (`ClaudeCode`) | 3 |
| System messages (`type: 8`, member join) | 1 |
| Human posts with no text body | 1 |
| **Genuine human announcements** | **~4** (over roughly two weeks) |

Badging all 50 would make the number meaningless within a week. Keep a message only when
**all** of these hold:

1. `webhook_id` is absent
2. `author.bot !== true`
3. `type` is `0` (default) or `19` (reply)
4. it has non-empty `content`, or at least one attachment or embed

`title` is the first non-empty line of `content`, Markdown stripped (`**`, `__`, backticks,
leading `#`), custom emoji shortcodes removed, truncated to 90 chars on a word boundary.
Discord mention tokens (`<@…>`, `<#…>`, `@everyone`) are stripped from the title — a badge
title is not the place to re-render a ping.

**Cache 5 minutes in-process.** Discord rate-limits per-route and every member's poll hits
the same channel; without a cache, 40 members polling every 15 minutes is 40 identical
requests. The cache makes it ~12 an hour regardless of membership size.

**Credential:** `SB118_DISCORD_BOT_TOKEN` exists in `~/.secrets.env` but is **not** in the
Ansible vault or the megatool container. Adding it is part of slice 3. Read-only usage here —
the same token also posts elsewhere, so do not scope it down without checking what else uses
it.

**Bot identity gotcha:** two bots in this guild are named `ClaudeCode`. Only
`1478760290161266921` matches `SB118_DISCORD_BOT_TOKEN`. Confirm with `GET /users/@me` before
concluding a permission grant applies. (Read access to this channel was verified working on
2026-08-08: `HTTP 200`, messages returned.)

### Source 2 — sims

1. Resolve the caller's `writer_id` from the session (`resolveMemberContext`).
2. Read **all** their `writer_ids` rows — join on the `writer_id` **string**, never
   `writer_ids.member_id`, which is a junk Links field. A `writer_ids` row is a *placement*,
   so a member with several placements has several rows.
3. Take the distinct `ship_name` values, canonicalized through `resolveCanonicalShipName()`.
4. `listShipSims(ship, { limit })` per ship, merge, sort by `postedDay` descending, truncate
   to `limit`.
5. **Drop sims the caller wrote** — where `authorWriterId` equals their writer_id, or their
   character name appears in `coAuthorNames`. Nobody needs a badge for their own post.

`title` is the sim's `subject`; `url` is built from `urlKey` the same way the main-site sim
permalinks are; `at` is `postedDay`.

**Two deliberate divergences from the Fleet Status count rules**
(`project_sb118_fleet_status_count_rules`), because this answers a different question:

- **Part-time placements are included.** Fleet Status excludes them; Jordan confirmed
  2026-08-08 that a writer wants sims from every ship they actually play on.
- **A member on LOA with zero placement rows gets `items: []`, not `unavailable`.** Having no
  placement is a legitimate state, not a failure. (This is the same trap as the 2026-07-29
  `/loa/[id]` 500.)

**Verify at build time:** the exact predicate for "active placement" must be checked against
the live `writer_ids` schema before coding — `awards-roster-snapshot.ts:148` is the reference
for how placement rows are read today, and it filters `is_primary` only. Do not assume a
status column exists on `writer_ids`; member status lives on `members`.

### Source 3 — news

`GET https://www.starbase118.net/feed` — public RSS, verified `200 application/rss+xml` on
2026-08-08. Fetched server-side so the extension needs no new host permission and no
client-side XML parsing.

Map `<item>`: `title` → `title`, `link` → `url`, `pubDate` → `at` (parsed to ISO), `guid` (or
`link` as fallback) → `id`. Cache 10 minutes.

Parse defensively: a feed that fails to parse is `unavailable`, not an empty list.

## Extension side

### Badge

`src/background.ts` — currently empty, and this is what it is for.

- `chrome.alarms.create('notif-poll', { periodInMinutes: 15 })`, plus a poll on
  `runtime.onStartup` and `runtime.onInstalled`.
- MV3 service workers are terminated aggressively; alarms survive that, in-memory state does
  not. **All state goes in `storage.local`** — never a module-level variable.
- Badge text is the total across **enabled** sources, `''` when zero, `'9+'` above nine.
- Badge background uses the SB118 brand colour from
  `sb118/branding/BRAND-REFERENCE.md`; confirm the value there rather than picking one.

### Counting and clearing

`storage.local` holds `lastSeen: { announcements, sims, news }` as ISO strings. A source's
count is the number of returned items with `at > lastSeen[source]`; absent marker means every
returned item counts, so a fresh install shows what is genuinely recent rather than zero.

**Opening the popup marks every enabled, displayed source as seen** — each marker advances to
that source's newest item timestamp, and the badge clears. Markers only move forward, so a
stale poll can never resurrect a cleared badge.

### Toggles

Extend `src/lib/prefs.ts` with `notifications: { announcements: true, sims: true, news: true }`
— all default on. Three checkboxes on the options page.

**A disabled source is not requested.** It drops out of the `sources=` param, so turning one
off actually removes the work rather than hiding the number. A disabled source is also
excluded from the badge total and hidden in the popup.

### The first-run note

Jordan's explicit ask, and the thing that stops the badge feeling like something done *to*
you: **the first time the badge shows a non-zero count**, the popup renders a one-time,
dismissible line at the top of the notifications area — what the number counts, and that any
of the three can be switched off, with a link straight to the options page.

`notifIntroDismissed` in `storage.local` gates it, so it appears once per browser and never
again. Show it on the first *non-zero* badge, not on install: an explanation of a number you
have not yet seen is noise.

## Slices

Each slice ships and is verified on its own. Slices 1–3 are independent of each other; the
extension renders any source that is not yet live as `unavailable`, which is the designed
degradation, not a bug.

1. **HQ endpoint, news only.** Public source, no new credential, smallest possible first cut
   of the route + envelope + firewall entry.
2. **HQ endpoint, sims.** Placement fan-out, canonical ship names, self-authored exclusion.
3. **HQ endpoint, announcements.** Needs `SB118_DISCORD_BOT_TOKEN` added to the vault and the
   megatool secrets role — remember `--tags secrets` runs **before** `deploy-megatool.sh`,
   which only runs `--tags megatool`.
4. **Extension: badge.** Alarm, poll, `storage.local` markers, badge text, clear on popup
   open.
5. **Extension: toggles + first-run note.** Options checkboxes, `sources=` narrowing, the
   one-time explainer.

## Testing

Same split as Phase 2, which worked well: pure mapping functions tested exhaustively against
recorded payloads, I/O behind a thin seam that route tests mock.

- `announcements-filter.ts` (pure) — the four-condition filter, against a recorded 50-message
  payload. **At minimum: a webhook post, a bot-user post, a `type: 8` join, an empty-content
  post, and a genuine human announcement.** These are real cases from the live channel, not
  invented ones.
- `notification-map.ts` (pure) — RSS item → item shape; sim row → item shape; self-authored
  exclusion; newest-first ordering.
- Route tests — 401 unauthenticated; `sources=` narrowing actually skips the unrequested
  fetches; one failing source yields `unavailable` while the others still return; CORS
  headers.
- Extension — count-vs-marker arithmetic including the absent-marker case, the `9+` cap,
  markers only moving forward, and a disabled source being excluded from both the request and
  the total.

## Open items

1. **Badge colour** — take from `sb118/branding/BRAND-REFERENCE.md`, do not invent.
2. **`writer_ids` active-placement predicate** — verify against the live schema before slice 2.
3. **Poll interval** — 15 minutes is a guess balancing freshness against Discord rate limits.
   Worth revisiting after the pilot; it is one constant.

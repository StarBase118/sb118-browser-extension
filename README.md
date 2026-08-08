# StarBase 118 Browser Extension

![CI](https://github.com/StarBase118/sb118-browser-extension/actions/workflows/ci.yml/badge.svg)

A browser extension for the [StarBase 118](https://www.starbase118.net) community — one launcher, search box, and personalized dashboard for every SB118 web property. Safe for the whole membership: it never stores or fills passwords, relying entirely on the existing Authentik single-sign-on session.

Tiered: every member gets a core set of features; staff get extra admin tools that light up automatically.

## Status

**v0.2.0 — Phases 1, 2 and 3 are all shipped and deployed.** See [`ROADMAP.md`](ROADMAP.md).

| Phase | What | State |
|-------|------|-------|
| 1 | Launcher, login light, my ship/character, pinned links, staff tiering, `/api/me` backbone | ✅ **Done + deployed** |
| 2 | Federated search (HQ destinations, wiki, main site, staff Discourse) | ✅ **Done + deployed** |
| 3 | Notification badge (announcements, sims, news), per-source toggles, first-run explainer | ✅ **Done + deployed** |
| 4 | Glossary tooltips, staff member-lookup, feedback-queue peek | ⬜ Planned |

Currently in a **staff test round** — see [`docs/STAFF-TEST.md`](docs/STAFF-TEST.md) if you were
asked to try it.

## What it does

- **Quick-launch popup** — HQ, Wiki, Discord, Main site, Sim archive (staff also see Forums + admin links).
- **Search** — one box across HQ pages, the wiki, the main site (news, pages, sims) and the staff forum. Results are grouped by source and each group appears the moment that source answers. `Ctrl+Shift+S` (`Cmd+Shift+S` on macOS) opens the popup with the box focused.
- **Login status light** — green when you have an Authentik session; one click to log in when not.
- **My ship / My character** — one click to your wiki pages, from `/api/me`.
- **Pinned links** — pin any page for one-click return.
- **Notification badge** — a count on the toolbar icon for new announcements, new sims on your ship, and new Community News. Opening the popup clears it. Each of the three can be switched off independently on the options page.
- **Staff tiering** — a staff section (Forums, Authentik, n8n, Forum admin) appears when HQ reports you're staff.

### How search behaves

- **HQ pages match locally**, from the cached list `/api/me` returns, so they appear before any request is made. Everything else needs 2+ characters.
- **Signed out still works** — wiki, news, pages and sims are public. HQ pages and the forum simply do not appear.
- **One dead source does not break the others.** A failed or slow source shows as "… unavailable" inside its own group; the rest render normally.
- **Nothing you cannot open is ever listed.** HQ filters the page list to your groups, and the forum is searched as you, by Discourse, with its own permissions applied.

## Architecture

Two pieces:

1. **The extension** (this repo) — Manifest V3, one shared codebase for Chromium (Chrome/Edge/Brave) plus a Firefox build. TypeScript, Vite build, `webextension-polyfill`. Logic lives in small, vitest-tested modules (`src/lib/`); the popup/options are thin wiring.
2. **`GET /api/me`** — a read-only endpoint on the [HQ megatool](https://hq.starbase118.net) (`sb118-megatool` repo) that reads the caller's Authentik/NextAuth session and returns their ship, character, staff flag, and (later) notifications + announcements. This is the only new backend surface.

**Auth model:** no passwords. The extension makes credentialed cross-site fetches to HQ; the Authentik session cookie rides along (confirmed in Chrome — see [`docs/superpowers/SPIKE-RESULT.md`](docs/superpowers/SPIKE-RESULT.md)). Firefox behaviour still to be verified.

## Install

**Not in the browser stores yet.** Download a build from
[Releases](https://github.com/StarBase118/sb118-browser-extension/releases) — no Node, no
build step:

- **Chrome / Edge / Brave** — download `sb118-extension-chromium-<version>.zip` and unzip it.
  Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose
  the unzipped folder. It stays installed across restarts.
- **Firefox** — download `sb118-extension-firefox-<version>.zip` and unzip it. Go to
  `about:debugging` → **This Firefox** → **Load Temporary Add-on**, and choose the
  `manifest.json` inside. Firefox drops temporary add-ons when you restart it, so you will
  need to load it again next time.

Keep the unzipped folder where it is — deleting it uninstalls the extension.

<details>
<summary>Or build it yourself (needs <a href="https://nodejs.org">Node.js</a> 22+)</summary>

```bash
git clone https://github.com/StarBase118/sb118-browser-extension.git
cd sb118-browser-extension
npm install
npm run build
```

Then load `dist/chromium` (or `dist/firefox/manifest.json`) exactly as above.

</details>

Sign in to [HQ](https://hq.starbase118.net) as usual in a normal tab. The extension picks up
that session — the light in the popup turns green when it has one.

## Privacy

- **It never asks for, stores, or fills a password.** Signing in happens on StarBase 118's own
  page, in a normal tab.
- **It talks only to StarBase 118.** HQ, the wiki, the main site and the staff forum. Nothing
  goes anywhere else.
- **No analytics, no telemetry, no third-party services.** Nobody is counting your clicks.
- **What you type in the search box** goes to the SB118 systems being searched, and nowhere
  else. It is not logged or stored by the extension.
- **Pinned links, your manual ship/character settings, and what the badge has counted** stay
  in your own browser. Nothing about what you have read is sent anywhere — which is also why
  the badge does not sync between two computers.
- **The badge checks HQ every 15 minutes** while your browser is running, and only for the
  sources you have left switched on. Switching one off stops asking for it, rather than
  hiding a number that was fetched anyway.
- **You only ever see what you already have access to.** HQ decides which pages appear for
  you, and the forum is searched as you, with its own permissions applied.

## Reporting a problem

Open an issue using one of the templates. For anything security-related, follow
[SECURITY.md](SECURITY.md) instead — please don't describe it in a public issue.

## Develop

```bash
npm install
npm test          # vitest — all lib modules
npm run typecheck # tsc --noEmit
npm run build     # -> dist/chromium and dist/firefox
```

## Layout

```
src/
  background.ts          service worker (Phase 3 badge polling lands here)
  manifest.chromium.json / manifest.firefox.json
  lib/
    launcher.ts          member + staff link config
    session.ts           getProfile() — direct fetch of /api/me
    api.ts               ApiMeResponse type (mirror of the megatool's)
    pins.ts              pinned links (storage.local)
    prefs.ts             manual ship/character fallback (storage.local)
    nav-cache.ts         cached HQ page list from /api/me nav[]
    destinations.ts      local matching + ranking of that page list
    search-sources.ts    wiki / main-site / forum clients, each failing alone
    search.ts            orchestrator — fan out, emit per group, abort on retype
    search-types.ts      shared hit/group shapes and the tuning constants
  popup/                 popup.html / popup.css / popup.ts
  options/               options page
scripts/build.mjs        dual-target Vite build
tests/                   vitest specs for every lib module
docs/superpowers/        spec, plan, spike result
preview/                 design reference renders of the popup
```

## Docs

- Design spec: `docs/superpowers/specs/2026-07-24-sb118-browser-extension-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-07-24-sb118-extension-phase1.md`
- Session-access spike: `docs/superpowers/SPIKE-RESULT.md`

SB118-only. No CampaignHelp/MFC coupling.

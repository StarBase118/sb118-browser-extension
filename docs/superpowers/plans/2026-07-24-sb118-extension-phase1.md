# SB118 Browser Extension — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **In this project, Codex executes each slice literally and Claude reviews + tests between slices.**

**Goal:** Ship the Phase 1 backbone — a Manifest V3 browser extension (Chromium + Firefox) that launches every SB118 property, shows a login-status light, surfaces your ship/character, and lets you pin links — backed by one new HQ endpoint (`GET /api/me`).

**Architecture:** Two deliverables in two repos. (A) `sb118-megatool` gains a thin `GET /api/me` route that wraps the existing NextAuth `auth()` + `resolveMemberContext()` and returns the caller's profile, staff flag, ship, and character. (B) A new `sb118-browser-extension` repo holds an MV3 extension whose popup (stacked-dashboard "layout A") reads `/api/me` for personalization and falls back to a static launcher if the session isn't available. All logic lives in small, pure, vitest-tested modules; the popup/background are thin wiring over them.

**Tech Stack:** TypeScript, Vite (extension bundling), Vitest (both repos' tests), `webextension-polyfill` (cross-browser `browser.*`), Next.js 15 App Router + NextAuth v5 (megatool, existing).

## Global Constraints

- **No stored passwords, no autofill, no secrets in the extension bundle.** Auth is the user's own Authentik/NextAuth session cookie only.
- **SB118-only.** Extension repo under the `StarBase118` GitHub org; SB118 Authentik/infra/Cloudflare only. Never touch CH or MFC.
- **Browsers:** Chromium (Chrome/Edge/Brave, one build) + Firefox (second build). No Safari.
- **`/api/me` is read-only** and additive. `POST /api/me/seen` and staff endpoints are NOT in Phase 1 — do not build them.
- **Personalized features degrade gracefully:** if `/api/me` returns 401/unreachable, the popup still works as a static launcher + manual ship/character (from options).
- **Popup layout = "A / stacked dashboard"** (header+login light → search box placeholder → quick-launch grid → My stuff → pinned → announcements-empty). Search executes in Phase 2 — Phase 1 renders the box but wires no results yet.
- **HQ is a production system with serialized deploys.** Its `/api/me` changes ship through HQ's own review and deploy process, not from this repo.
- **Member launcher links (no Forums — staff-only):** HQ `https://hq.starbase118.net` · Wiki `https://wiki.starbase118.net` · Discord (invite URL — confirm in Slice 3) · Main site `https://www.starbase118.net` · Library `https://library.starbase118.net` · Sim archive (confirm URL in Slice 3).
- **Staff links (shown only when `isStaff`):** Forums `https://staff.starbase118.net` · Authentik admin `https://auth.starbase118.net` · n8n `https://n8n.starbase118.net` · Discourse admin `https://staff.starbase118.net/admin` · HQ admin panels. **NocoDB is deliberately NOT linked.**
- **Commit style:** frequent, conventional-commit messages, co-authored by Claude. Extension repo commits straight to `main` during greenfield build; megatool uses a PR.

---

## Slice 0: Session-access spike (Claude-driven — NOT a Codex task)

**Why first:** every personalized feature depends on the extension reading the live Authentik/NextAuth session. That cookie is `SameSite=Lax`, and a `fetch` from an extension origin to `hq.starbase118.net` is cross-site — Lax cookies may not be sent. This spike empirically picks the mechanism Slice 5 implements. **Slices 1–4 do NOT depend on the outcome and proceed in parallel.**

**Owner:** Claude, using Jordan's logged-in browser (Screen Sharing / Chrome MCP). Codex does not run this.

**Procedure:**
- [ ] Build a throwaway unpacked MV3 extension with host permission for `https://hq.starbase118.net/*` and a background action that runs `fetch('https://hq.starbase118.net/api/version', {credentials:'include'})` and logs status + whether a `Set-Cookie`/authenticated response returns. (Use `/api/version` until `/api/me` exists; then re-test against `/api/me`.)
- [ ] With Jordan signed in to Authentik, load the unpacked extension in Chrome and observe: does the credentialed cross-site fetch carry the session cookie (i.e. does an authenticated route return 200 with the user's data, not 401)?
- [ ] If **direct fetch works** → record mechanism = **direct**. Slice 5 uses the direct-fetch client.
- [ ] If **direct fetch is unauthenticated (401)** → test the **content-script relay**: content script injected into an open `hq.starbase118.net` tab performs the same-origin fetch and `postMessage`s the result to the service worker. Record mechanism = **relay**.
- [ ] Write the decision + evidence to `docs/superpowers/SPIKE-RESULT.md` in the extension repo: `MECHANISM: direct | relay`, plus any cookie/CORS notes.

**Deliverable:** `SPIKE-RESULT.md` with a definitive `MECHANISM:` line. This gates Slice 5 only.

---

## Slice 1 (megatool repo): `GET /api/me`

**Repo:** `sb118-megatool` (`~/ClaudeCode/sb118/megatool`). Work in a worktree on branch `add-api-me`. Open a PR at the end.

**Files:**
- Create: `src/app/api/me/route.ts`
- Create: `src/app/api/me/__tests__/route.test.ts`
- Reference (do not modify): `src/lib/auth.ts` (`auth()`), `src/lib/member-context.ts` (`resolveMemberContext`), `src/types/groups.ts` (`isStaff`), `src/lib/nocodb.ts`, `src/app/api/awards/cors.ts` (CORS pattern).

**Interfaces:**
- Consumes: `auth()` → `Session | null` where `session.user = { email, id, groups: string[] }`; `resolveMemberContext(session)` → `{ email, writer_id, member_id, character_name, ship_name, rank_name }`; `isStaff(groups: string[]) => boolean`.
- Produces (the `/api/me` JSON contract the extension's Slice 5 consumes):

```ts
// src/app/api/me/types.ts  (create this file too, exported for reuse/tests)
export interface ApiMeResponse {
  authenticated: true
  writer_id: string | null
  displayName: string | null
  isStaff: boolean
  staffRoles: string[]                 // the caller's own group names, intersected with staff groups
  ship: { name: string | null; wikiUrl: string | null }
  character: { name: string | null; wikiUrl: string | null }
  notifications: {                     // Phase 1: counts are 0 and latest null (sources land in Phase 3)
    sims: { count: number; latest: string | null }
    discord: { count: number; latest: string | null }
    forum: { count: number; latest: string | null }
  }
  announcements: never[]               // Phase 1: always [] (source deferred to Phase 3)
}
export interface ApiMeUnauthenticated { authenticated: false }
```

- [ ] **Step 1: Create the shared types file**

Create `src/app/api/me/types.ts` with exactly the two interfaces shown in the Interfaces block above.

- [ ] **Step 2: Write the failing test**

Create `src/app/api/me/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be declared before importing the route.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/member-context', () => ({ resolveMemberContext: vi.fn() }))

import { auth } from '@/lib/auth'
import { resolveMemberContext } from '@/lib/member-context'
import { GET } from '../route'

const authMock = auth as unknown as ReturnType<typeof vi.fn>
const ctxMock = resolveMemberContext as unknown as ReturnType<typeof vi.fn>

function req(origin = 'chrome-extension://abc') {
  return new Request('https://hq.starbase118.net/api/me', {
    headers: { origin },
  }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  authMock.mockReset()
  ctxMock.mockReset()
})

describe('GET /api/me', () => {
  it('returns 401 authenticated:false when there is no session', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ authenticated: false })
  })

  it('returns the profile with isStaff=true for a staff member', async () => {
    authMock.mockResolvedValue({
      user: { email: 'wolf@starbase118.net', id: 'sub1', groups: ['ec', 'training-officer'] },
    })
    ctxMock.mockResolvedValue({
      email: 'wolf@starbase118.net',
      writer_id: 'A239905NR1',
      member_id: 5,
      character_name: 'Wolf',
      ship_name: 'USS Example',
      rank_name: 'Captain',
    })
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.isStaff).toBe(true)
    expect(body.staffRoles).toEqual(['ec', 'training-officer'])
    expect(body.character.name).toBe('Wolf')
    expect(body.ship.name).toBe('USS Example')
    expect(body.notifications.sims).toEqual({ count: 0, latest: null })
    expect(body.announcements).toEqual([])
  })

  it('returns isStaff=false for a member with no staff groups', async () => {
    authMock.mockResolvedValue({ user: { email: 'm@x.net', id: 's', groups: ['hq-access'] } })
    ctxMock.mockResolvedValue({
      email: 'm@x.net', writer_id: 'B1', member_id: 2,
      character_name: 'Cadet', ship_name: 'USS Foo', rank_name: 'Ensign',
    })
    const res = await GET(req())
    const body = await res.json()
    expect(body.isStaff).toBe(false)
    expect(body.staffRoles).toEqual([])
  })

  it('sets CORS headers for an extension origin', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(req('chrome-extension://abc'))
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abc')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ~/ClaudeCode/sb118/megatool && npx vitest run src/app/api/me/__tests__/route.test.ts`
Expected: FAIL — `../route` has no export `GET`.

- [ ] **Step 4: Implement the route**

Create `src/app/api/me/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { resolveMemberContext } from '@/lib/member-context'
import { STAFF_GROUPS, isStaff } from '@/types/groups'
import type { ApiMeResponse } from './types'

// Extension origins are chrome-extension:// (Chromium) and moz-extension:// (Firefox).
// We echo the caller's origin (credentialed CORS cannot use "*") when it is an
// extension origin. This is harmless for a read-only endpoint; the response only
// ever reflects the caller's own session.
function isExtensionOrigin(origin: string | null): origin is string {
  return !!origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))
}

function withCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get('origin')
  if (isExtensionOrigin(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    response.headers.set('Vary', 'Origin')
  }
  response.headers.set('Cache-Control', 'no-store')
  return response
}

const emptyNotif = { count: 0, latest: null as string | null }

export async function OPTIONS(request: NextRequest) {
  return withCors(request, new NextResponse(null, { status: 204 }))
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return withCors(request, NextResponse.json({ authenticated: false }, { status: 401 }))
  }

  const ctx = await resolveMemberContext(session)
  const groups: string[] = session.user.groups ?? []
  const staffRoles = groups.filter((g) => (STAFF_GROUPS as readonly string[]).includes(g))

  const body: ApiMeResponse = {
    authenticated: true,
    writer_id: ctx.writer_id,
    displayName: ctx.character_name ?? session.user.name ?? null,
    isStaff: isStaff(groups),
    staffRoles,
    // Phase 1: ship/character wikiUrl are best-effort. character.wikiUrl comes
    // from NocoDB characters.wiki_url in a later slice; keep null here so the
    // shape is stable and the extension renders name-only links meanwhile.
    ship: { name: ctx.ship_name, wikiUrl: null },
    character: { name: ctx.character_name, wikiUrl: null },
    notifications: { sims: { ...emptyNotif }, discord: { ...emptyNotif }, forum: { ...emptyNotif } },
    announcements: [],
  }
  return withCors(request, NextResponse.json(body, { status: 200 }))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/api/me/__tests__/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Confirm the route is not blocked by middleware auth-gating**

Read `src/types/groups.ts` `ROUTE_GROUPS` and the middleware. `/api/me` must be reachable by any authenticated user (it returns 401 itself when unauthenticated). If `ROUTE_GROUPS` or middleware would redirect/gate `/api/me`, add `/api/me` to the open list. Run the app's typecheck: `npx tsc --noEmit` — Expected: no new errors.

- [ ] **Step 7: Commit and open the PR**

```bash
git add src/app/api/me
git commit -m "feat(api): add GET /api/me profile endpoint for the browser extension"
```
Push the branch and open a PR against `main` (account `ufopsb118`, per github-ops). Do NOT deploy yet — deploy happens in Slice 7 after review.

---

## Slice 2 (extension repo): scaffold + dual manifests + build

**Repo:** new `sb118-browser-extension` (`~/ClaudeCode/sb118/browser-extension`, already git-init'd). Commit to `main`.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`
- Create: `src/manifest.chromium.json`, `src/manifest.firefox.json`
- Create: `scripts/build.mjs` (emits `dist/chromium/` and `dist/firefox/`)
- Create: `src/background.ts` (minimal keepalive/no-op for now)
- Create: `.gitignore` additions for `dist/` and `node_modules/`

**Interfaces:**
- Produces: an installable unpacked extension in `dist/chromium` and `dist/firefox`; npm scripts `build`, `test`, `typecheck`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "sb118-browser-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "@types/webextension-polyfill": "^0.12.0"
  },
  "dependencies": {
    "webextension-polyfill": "^0.12.0"
  }
}
```

Run: `cd ~/ClaudeCode/sb118/browser-extension && npm install`
Expected: installs cleanly. **Before relying on these versions, vet them** (deptrust) and bump to the latest safe releases if any is flagged.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["webextension-polyfill", "vitest/globals"],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "scripts", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  test: { environment: 'jsdom', globals: true, include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

- [ ] **Step 4: Create the two manifests**

`src/manifest.chromium.json`:

```json
{
  "manifest_version": 3,
  "name": "StarBase 118",
  "version": "0.1.0",
  "description": "Quick access to StarBase 118 — HQ, wiki, Discord, and your ship & character.",
  "action": { "default_popup": "popup/popup.html", "default_title": "StarBase 118" },
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["storage"],
  "host_permissions": [
    "https://hq.starbase118.net/*",
    "https://wiki.starbase118.net/*",
    "https://staff.starbase118.net/*"
  ],
  "options_ui": { "page": "options/options.html", "open_in_tab": true },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

`src/manifest.firefox.json` — identical EXCEPT background is an event script and it declares a gecko id:

```json
{
  "manifest_version": 3,
  "name": "StarBase 118",
  "version": "0.1.0",
  "description": "Quick access to StarBase 118 — HQ, wiki, Discord, and your ship & character.",
  "action": { "default_popup": "popup/popup.html", "default_title": "StarBase 118" },
  "background": { "scripts": ["background.js"], "type": "module" },
  "permissions": ["storage"],
  "host_permissions": [
    "https://hq.starbase118.net/*",
    "https://wiki.starbase118.net/*",
    "https://staff.starbase118.net/*"
  ],
  "options_ui": { "page": "options/options.html", "open_in_tab": true },
  "browser_specific_settings": { "gecko": { "id": "sb118-extension@starbase118.net", "strict_min_version": "128.0" } },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

- [ ] **Step 5: Create a minimal `src/background.ts`**

```ts
// Phase 1 background worker: no active behavior yet (badge polling lands in Phase 3).
// Present so the manifest's background entry resolves and the worker registers.
import browser from 'webextension-polyfill'
browser.runtime.onInstalled.addListener(() => {
  console.debug('[sb118] extension installed')
})
```

- [ ] **Step 6: Write `scripts/build.mjs`**

```js
import { build } from 'vite'
import { cpSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const targets = [
  { name: 'chromium', manifest: 'src/manifest.chromium.json' },
  { name: 'firefox', manifest: 'src/manifest.firefox.json' },
]

for (const t of targets) {
  const outDir = resolve(root, 'dist', t.name)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  await build({
    root,
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          background: resolve(root, 'src/background.ts'),
          popup: resolve(root, 'src/popup/popup.ts'),
          options: resolve(root, 'src/options/options.ts'),
        },
        output: { entryFileNames: '[name].js', format: 'es' },
      },
    },
  })
  // Static assets
  copyFileSync(resolve(root, t.manifest), resolve(outDir, 'manifest.json'))
  cpSync(resolve(root, 'src/popup'), resolve(outDir, 'popup'), { recursive: true, filter: (s) => !s.endsWith('.ts') })
  cpSync(resolve(root, 'src/options'), resolve(outDir, 'options'), { recursive: true, filter: (s) => !s.endsWith('.ts') })
  cpSync(resolve(root, 'src/icons'), resolve(outDir, 'icons'), { recursive: true })
  console.log(`built dist/${t.name}`)
}
```

(Popup/options `.ts` compile to `dist/<t>/popup.js` etc.; the HTML in `popup/` references `../popup.js`. Placeholder icons: create three solid-navy PNGs at `src/icons/icon{16,48,128}.png` — a 1-color square is fine for Phase 1.)

- [ ] **Step 7: Add placeholder popup/options so the build resolves**

Create `src/popup/popup.html`, `src/popup/popup.ts` (empty `export {}`), `src/options/options.html`, `src/options/options.ts` (empty `export {}`) as stubs — Slices 3–6 fill them. Create the three icon PNGs.

- [ ] **Step 8: Build and verify output**

Run: `npm run build`
Expected: prints `built dist/chromium` and `built dist/firefox`; both dirs contain `manifest.json`, `background.js`, `popup/popup.html`, `popup.js`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: extension scaffold with dual chromium/firefox manifests and build"
```

---

## Slice 3 (extension repo): launcher config + popup shell (static links)

**Files:**
- Create: `src/lib/launcher.ts` (link definitions + tiering filter)
- Create: `tests/launcher.test.ts`
- Create/replace: `src/popup/popup.html`, `src/popup/popup.css`, `src/popup/popup.ts`

**Interfaces:**
- Produces: `LinkDef { id: string; label: string; url: string; tier: 'member' | 'staff' }`; `MEMBER_LINKS: LinkDef[]`; `STAFF_LINKS: LinkDef[]`; `visibleLinks(isStaff: boolean): LinkDef[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/launcher.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MEMBER_LINKS, STAFF_LINKS, visibleLinks } from '@/lib/launcher'

describe('launcher config', () => {
  it('member links never include Forums or NocoDB', () => {
    const labels = MEMBER_LINKS.map((l) => l.label.toLowerCase())
    expect(labels).not.toContain('forums')
    expect(labels.join(' ')).not.toContain('nocodb')
  })
  it('no staff link is NocoDB', () => {
    expect(STAFF_LINKS.map((l) => l.label.toLowerCase())).not.toContain('nocodb')
  })
  it('visibleLinks(false) returns only member links', () => {
    expect(visibleLinks(false)).toEqual(MEMBER_LINKS)
  })
  it('visibleLinks(true) returns member + staff links', () => {
    expect(visibleLinks(true)).toEqual([...MEMBER_LINKS, ...STAFF_LINKS])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- launcher`
Expected: FAIL — `@/lib/launcher` not found.

- [ ] **Step 3: Implement `src/lib/launcher.ts`**

```ts
export interface LinkDef { id: string; label: string; url: string; tier: 'member' | 'staff' }

export const MEMBER_LINKS: LinkDef[] = [
  { id: 'hq', label: 'HQ', url: 'https://hq.starbase118.net', tier: 'member' },
  { id: 'wiki', label: 'Wiki', url: 'https://wiki.starbase118.net', tier: 'member' },
  { id: 'discord', label: 'Discord', url: 'https://discord.gg/starbase118', tier: 'member' }, // confirm invite in review
  { id: 'site', label: 'Main site', url: 'https://www.starbase118.net', tier: 'member' },
  { id: 'library', label: 'Library', url: 'https://library.starbase118.net', tier: 'member' },
  { id: 'sims', label: 'Sim archive', url: 'https://www.starbase118.net/sims', tier: 'member' }, // confirm in review
]

export const STAFF_LINKS: LinkDef[] = [
  { id: 'forums', label: 'Forums', url: 'https://staff.starbase118.net', tier: 'staff' },
  { id: 'authentik', label: 'Authentik', url: 'https://auth.starbase118.net', tier: 'staff' },
  { id: 'n8n', label: 'n8n', url: 'https://n8n.starbase118.net', tier: 'staff' },
  { id: 'discourse-admin', label: 'Forum admin', url: 'https://staff.starbase118.net/admin', tier: 'staff' },
]

export function visibleLinks(isStaff: boolean): LinkDef[] {
  return isStaff ? [...MEMBER_LINKS, ...STAFF_LINKS] : [...MEMBER_LINKS]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- launcher` → Expected: PASS.

- [ ] **Step 5: Build the popup shell**

`src/popup/popup.html` (references compiled `../popup.js`; `<head>` minimal):

```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<link rel="stylesheet" href="popup.css">
<title>StarBase 118</title>
</head><body>
<header id="ph"><span class="brand">🛰 StarBase 118</span><span id="login" class="light" title="Login status">●</span></header>
<div class="pin"><input id="search" placeholder="Search SB118…" disabled></div>
<nav id="grid" class="grid" aria-label="Quick launch"></nav>
<section id="mystuff" class="sec" hidden><span class="lbl">My stuff</span><div id="mychips" class="chips"></div></section>
<section id="pins" class="sec"><span class="lbl">Pinned</span><div id="pinchips" class="chips"></div></section>
<section id="staff" class="sec staff" hidden><span class="lbl">Staff</span><div id="staffgrid" class="chips"></div></section>
<script type="module" src="popup.js"></script>
</body></html>
```

`src/popup/popup.css` — minimal dark styling (width 340px). (Full CSS omitted here for brevity but MUST be written: `body{width:340px;margin:0;font-family:system-ui;background:#11162a;color:#dfe6ff}` plus `.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px}` `.grid a{background:#1a2244;border-radius:7px;padding:9px 2px;text-align:center;color:inherit;text-decoration:none;font-size:12px}` `.light{color:#4ade80}` `.light.off{color:#6b7280}` `.sec{padding:9px 12px;border-top:1px solid #222a4a}` `.lbl{color:#8ea2d8;font-size:10px;text-transform:uppercase}` `.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}` `.chip{background:#243056;border-radius:6px;padding:4px 9px;color:inherit;text-decoration:none;font-size:12px}` `.staff{background:#0e1730}`.)

`src/popup/popup.ts` — render the static grid now (personalization wired in Slice 5):

```ts
import browser from 'webextension-polyfill'
import { MEMBER_LINKS, STAFF_LINKS } from '@/lib/launcher'

function open(url: string) {
  return () => { browser.tabs.create({ url }); window.close() }
}
function renderGrid(el: HTMLElement, links: { label: string; url: string }[]) {
  el.innerHTML = ''
  for (const l of links) {
    const a = document.createElement('a')
    a.textContent = l.label
    a.href = l.url
    a.addEventListener('click', (e) => { e.preventDefault(); open(l.url)() })
    el.appendChild(a)
  }
}
document.addEventListener('DOMContentLoaded', () => {
  renderGrid(document.getElementById('grid')!, MEMBER_LINKS)
  // staff grid + my stuff + pins are populated in later slices
  void STAFF_LINKS
})
```

- [ ] **Step 6: Build + manual smoke check**

Run: `npm run build`. Load `dist/chromium` unpacked in Chrome (`chrome://extensions` → Load unpacked). Click the toolbar icon — Expected: popup shows the 6 member links; clicking one opens the site.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: popup shell with static member launcher grid"
```

---

## Slice 4 (extension repo): pinned links store + UI

**Files:**
- Create: `src/lib/pins.ts` (async wrapper over `storage.local`)
- Create: `tests/pins.test.ts`
- Modify: `src/popup/popup.ts` (render pins + a "pin current tab" affordance)

**Interfaces:**
- Produces: `interface Pin { label: string; url: string }`; `getPins(): Promise<Pin[]>`; `addPin(p: Pin): Promise<Pin[]>` (dedupes by url, caps at 20); `removePin(url: string): Promise<Pin[]>`.

- [ ] **Step 1: Write the failing test** (mock `webextension-polyfill` storage)

Create `tests/pins.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
    } },
  },
}))

import { getPins, addPin, removePin } from '@/lib/pins'

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('pins', () => {
  it('starts empty', async () => { expect(await getPins()).toEqual([]) })
  it('adds and dedupes by url', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await addPin({ label: 'A2', url: 'https://x/1' })
    expect(after).toHaveLength(1)
  })
  it('removes by url', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    expect(await removePin('https://x/1')).toEqual([])
  })
  it('caps at 20', async () => {
    for (let i = 0; i < 25; i++) await addPin({ label: `p${i}`, url: `https://x/${i}` })
    expect((await getPins()).length).toBe(20)
  })
})
```

- [ ] **Step 2: Run to verify it fails** → `npm test -- pins` → FAIL (no `@/lib/pins`).

- [ ] **Step 3: Implement `src/lib/pins.ts`**

```ts
import browser from 'webextension-polyfill'
export interface Pin { label: string; url: string }
const KEY = 'pins'

export async function getPins(): Promise<Pin[]> {
  const r = await browser.storage.local.get(KEY)
  const v = (r as Record<string, unknown>)[KEY]
  return Array.isArray(v) ? (v as Pin[]) : []
}
export async function addPin(p: Pin): Promise<Pin[]> {
  const pins = (await getPins()).filter((x) => x.url !== p.url)
  pins.unshift(p)
  const capped = pins.slice(0, 20)
  await browser.storage.local.set({ [KEY]: capped })
  return capped
}
export async function removePin(url: string): Promise<Pin[]> {
  const pins = (await getPins()).filter((x) => x.url !== url)
  await browser.storage.local.set({ [KEY]: pins })
  return pins
}
```

- [ ] **Step 4: Run to verify it passes** → `npm test -- pins` → PASS.

- [ ] **Step 5: Render pins in the popup + add a "pin this tab" button**

Modify `src/popup/popup.ts`: after `DOMContentLoaded`, call an async `renderPins()` that reads `getPins()` and fills `#pinchips` with chip links (each chip: click opens url; a small ✕ removes it via `removePin` then re-render). Add a "＋ Pin current tab" chip that reads the active tab (`browser.tabs.query({active:true,currentWindow:true})`), calls `addPin({label: tab.title, url: tab.url})`, re-renders.

```ts
import { getPins, addPin, removePin, type Pin } from '@/lib/pins'
async function renderPins() {
  const box = document.getElementById('pinchips')!
  box.innerHTML = ''
  for (const p of await getPins()) {
    const a = document.createElement('a'); a.className = 'chip'; a.textContent = '★ ' + p.label; a.href = p.url
    a.addEventListener('click', (e) => { e.preventDefault(); browser.tabs.create({ url: p.url }); window.close() })
    const x = document.createElement('button'); x.textContent = '✕'; x.className = 'x'
    x.addEventListener('click', async (e) => { e.stopPropagation(); await removePin(p.url); renderPins() })
    a.appendChild(x); box.appendChild(a)
  }
  const add = document.createElement('button'); add.className = 'chip'; add.textContent = '＋ Pin tab'
  add.addEventListener('click', async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.url) { await addPin({ label: tab.title ?? tab.url, url: tab.url }); renderPins() }
  })
  box.appendChild(add)
}
```

Call `renderPins()` in the `DOMContentLoaded` handler. Add `.x{margin-left:6px;background:none;border:none;color:#8ea2d8;cursor:pointer}` to `popup.css`. Manifest already has `storage`; add `"tabs"` permission is NOT needed for `tabs.create`, but reading `tab.url`/`tab.title` requires either `tabs` permission or an `activeTab` grant — **add `"tabs"` to both manifests' `permissions`** (documents this widening in the commit).

- [ ] **Step 6: Build + smoke check** → `npm run build`, reload unpacked, pin the current tab, confirm it appears and ✕ removes it.

- [ ] **Step 7: Commit** → `git commit -m "feat: pinned links store and popup UI"`.

---

## Slice 5 (extension repo): session client + login light + my ship/character + staff tiering

**Depends on Slice 0's `SPIKE-RESULT.md` (`MECHANISM: direct | relay`) and Slice 1's `/api/me` (deployed to a reachable HQ, or run locally).**

**Files:**
- Create: `src/lib/api.ts` (the `ApiMeResponse` type — copy from megatool `types.ts`, kept in sync manually)
- Create: `src/lib/session.ts` (fetches `/api/me` via the chosen mechanism)
- Create: `tests/session.test.ts`
- Modify: `src/popup/popup.ts` (login light, My stuff, staff grid)

**Interfaces:**
- Produces: `getProfile(): Promise<ApiMeResponse | null>` — resolves to the profile on 200, `null` on 401/error (so the popup degrades gracefully).

- [ ] **Step 1: Copy the response type** into `src/lib/api.ts` (the `ApiMeResponse` / `ApiMeUnauthenticated` interfaces from Slice 1's `types.ts`).

- [ ] **Step 2: Write the failing test** for the direct-fetch client

Create `tests/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('webextension-polyfill', () => ({ default: {} }))
import { getProfile } from '@/lib/session'

beforeEach(() => { vi.restoreAllMocks() })

describe('getProfile', () => {
  it('returns the profile on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ authenticated: true, isStaff: false, character: { name: 'X' } }),
      { status: 200 })))
    const p = await getProfile()
    expect(p?.authenticated).toBe(true)
  })
  it('returns null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"authenticated":false}', { status: 401 })))
    expect(await getProfile()).toBeNull()
  })
  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await getProfile()).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify it fails** → `npm test -- session` → FAIL.

- [ ] **Step 4: Implement `src/lib/session.ts` — USE THE MECHANISM FROM `SPIKE-RESULT.md`.**

**If `MECHANISM: direct`** (write this version):

```ts
import type { ApiMeResponse } from '@/lib/api'
const ENDPOINT = 'https://hq.starbase118.net/api/me'

export async function getProfile(): Promise<ApiMeResponse | null> {
  try {
    const res = await fetch(ENDPOINT, { credentials: 'include', headers: { accept: 'application/json' } })
    if (res.status !== 200) return null
    const body = (await res.json()) as ApiMeResponse
    return body.authenticated ? body : null
  } catch {
    return null
  }
}
```

**If `MECHANISM: relay`** (write this version instead — asks a content script running in an open HQ tab, or opens a hidden HQ tab, to do the same-origin fetch):

```ts
import browser from 'webextension-polyfill'
import type { ApiMeResponse } from '@/lib/api'

// The content script (src/content/hq-relay.ts, registered in the manifests for
// https://hq.starbase118.net/*) listens for {type:'sb118:getMe'} and replies with
// the same-origin fetch result. Here we find or open an HQ tab and message it.
export async function getProfile(): Promise<ApiMeResponse | null> {
  try {
    const tabs = await browser.tabs.query({ url: 'https://hq.starbase118.net/*' })
    let tabId = tabs[0]?.id
    let openedTemp = false
    if (tabId === undefined) {
      const t = await browser.tabs.create({ url: 'https://hq.starbase118.net/', active: false })
      tabId = t.id; openedTemp = true
      await new Promise((r) => setTimeout(r, 1500)) // let it load; content script auto-injects
    }
    const reply = (await browser.tabs.sendMessage(tabId!, { type: 'sb118:getMe' })) as
      | { ok: true; body: ApiMeResponse } | { ok: false }
    if (openedTemp) await browser.tabs.remove(tabId!)
    if (!reply || !reply.ok) return null
    return reply.body.authenticated ? reply.body : null
  } catch {
    return null
  }
}
```

For the relay case ALSO create `src/content/hq-relay.ts` and add a `content_scripts` block + `"tabs"` to both manifests:

```ts
import browser from 'webextension-polyfill'
browser.runtime.onMessage.addListener(async (msg: { type?: string }) => {
  if (msg?.type !== 'sb118:getMe') return
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: { accept: 'application/json' } })
    if (res.status !== 200) return { ok: false }
    return { ok: true, body: await res.json() }
  } catch { return { ok: false } }
})
```

- [ ] **Step 5: Run to verify the direct-fetch tests pass** → `npm test -- session` → PASS. (The relay path is validated by the Slice 0 spike + the manual smoke check in Step 7, since it needs a real tab.)

- [ ] **Step 6: Wire personalization into the popup**

Modify `src/popup/popup.ts`: on load, call `getProfile()`. Then:
- **Login light** `#login`: profile present → keep green (`.light`); profile null → add class `off` and make the header clickable to open `https://hq.starbase118.net/login`.
- **My stuff** `#mystuff`: if `profile?.character?.name` or `profile?.ship?.name`, unhide the section and add chips — "👤 " + character.name (link to `character.wikiUrl` if present, else HQ), "🚀 " + ship.name (link to `ship.wikiUrl` if present, else HQ). If both null, keep hidden.
- **Staff grid** `#staff`: if `profile?.isStaff`, unhide and render `STAFF_LINKS` into `#staffgrid` as chips; else keep hidden.
- All personalization is additive — if `getProfile()` returns null the static launcher already rendered, so nothing breaks.

```ts
import { getProfile } from '@/lib/session'
async function personalize() {
  const profile = await getProfile()
  const light = document.getElementById('login')!
  if (!profile) {
    light.classList.add('off')
    document.getElementById('ph')!.addEventListener('click', () => {
      browser.tabs.create({ url: 'https://hq.starbase118.net/login' }); window.close()
    })
    return
  }
  const mine = document.getElementById('mychips')!
  const add = (emoji: string, name: string | null, url: string | null) => {
    if (!name) return
    const a = document.createElement('a'); a.className = 'chip'; a.textContent = `${emoji} ${name}`
    a.href = url ?? 'https://hq.starbase118.net'
    a.addEventListener('click', (e) => { e.preventDefault(); browser.tabs.create({ url: a.href }); window.close() })
    mine.appendChild(a)
  }
  add('👤', profile.character?.name ?? null, profile.character?.wikiUrl ?? null)
  add('🚀', profile.ship?.name ?? null, profile.ship?.wikiUrl ?? null)
  if (mine.children.length) document.getElementById('mystuff')!.hidden = false
  if (profile.isStaff) {
    const sg = document.getElementById('staffgrid')!
    for (const l of STAFF_LINKS) {
      const a = document.createElement('a'); a.className = 'chip'; a.textContent = l.label; a.href = l.url
      a.addEventListener('click', (e) => { e.preventDefault(); browser.tabs.create({ url: l.url }); window.close() })
      sg.appendChild(a)
    }
    document.getElementById('staff')!.hidden = false
  }
}
```
Call `personalize()` in `DOMContentLoaded`.

- [ ] **Step 7: Build + smoke check with a real session**

Run `npm run build`; reload unpacked. With Jordan signed in to HQ: Expected — green light, "My stuff" shows his character + ship, staff section shows Forums/Authentik/n8n/Forum admin. Signed out (or in a fresh profile): light is grey, clicking the header opens HQ login, launcher still works.

- [ ] **Step 8: Commit** → `git commit -m "feat: /api/me session client, login light, my ship/character, staff tiering"`.

---

## Slice 6 (extension repo): options page (manual ship/character fallback + pin management)

**Files:**
- Create/replace: `src/options/options.html`, `src/options/options.css`, `src/options/options.ts`
- Create: `src/lib/prefs.ts` (manual overrides in `storage.local`)
- Create: `tests/prefs.test.ts`

**Interfaces:**
- Produces: `interface Prefs { manualShipUrl?: string; manualCharacterUrl?: string }`; `getPrefs(): Promise<Prefs>`; `setPrefs(p: Prefs): Promise<void>`.

- [ ] **Step 1: Write the failing test** for prefs (same storage-mock pattern as pins). Assert default `{}`, round-trip of `setPrefs`/`getPrefs`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/lib/prefs.ts`** (mirror `pins.ts` shape, key `'prefs'`, merge on set).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Build the options page** — an HTML form with: two URL inputs (manual character wiki URL, manual ship wiki URL) used only when `/api/me` doesn't supply them; a list of current pins with remove buttons (reuse `pins.ts`). `options.ts` loads current values, saves on submit, shows a "Saved" note.
- [ ] **Step 6: Use the fallback in the popup** — in `personalize()`, if `profile.character.wikiUrl` is null, fall back to `getPrefs().manualCharacterUrl`; same for ship. (Modify Slice 5's `add()` calls to await prefs once.)
- [ ] **Step 7: Build + smoke check** — set a manual character URL, confirm the "My stuff" chip uses it when the API returns null.
- [ ] **Step 8: Commit** → `git commit -m "feat: options page with manual ship/character fallback and pin management"`.

---

## Slice 7: integration, review, deploy

- [ ] **Step 1: Full test + typecheck both repos.** Extension: `npm test && npm run typecheck && npm run build`. Megatool: `npx vitest run src/app/api/me && npx tsc --noEmit`. All green.
- [ ] **Step 2: Review pass** — read every diff end-to-end: no secrets, host permissions minimal, no scope creep. Confirm the Discord invite + sim-archive URLs are correct (replace the placeholders in `launcher.ts` if not).
- [ ] **Step 3: Merge and deploy the HQ change** through HQ's own process, then verify live: `curl -s -o /dev/null -w '%{http_code}' https://hq.starbase118.net/api/me` returns 401 unauthenticated (proves the route is live and gated), and an authenticated browser fetch returns the profile.
- [ ] **Step 4: End-to-end smoke** — load `dist/chromium` in Chrome and `dist/firefox` in Firefox (`about:debugging` → Load Temporary Add-on → pick `dist/firefox/manifest.json`); confirm launcher, login light, My stuff, staff tiering, and pins all work against live `/api/me` in BOTH browsers.
- [ ] **Step 5: Record the HQ production touch** (PR link, deploy time, what was verified, rollback = revert PR).
- [ ] **Step 6: Final commit / tag** the extension repo `v0.1.0-phase1`.

---

## Self-review notes (spec coverage)

- Quick-launch ✓ (Slice 3), login light ✓ (Slice 5), my ship/character ✓ (Slice 5), pinned links ✓ (Slice 4), staff tiering ✓ (Slice 5), `/api/me` backbone ✓ (Slice 1), Chromium+Firefox builds ✓ (Slice 2/7), graceful degradation ✓ (Slice 5/6), session-access spike ✓ (Slice 0).
- **Deferred to later phases (correctly absent here):** unified search execution (Phase 2 — box rendered but disabled), notification badge + `/api/me/seen` (Phase 3), announcements population (Phase 3), glossary/member-lookup/feedback (Phase 4). The `/api/me` shape already carries the stable `notifications`/`announcements` fields so those phases don't reshape it.
- **Open placeholders to confirm during Slice 3/7 review (not code-gaps, real-world values):** the Discord invite URL and the sim-archive URL in `launcher.ts`.

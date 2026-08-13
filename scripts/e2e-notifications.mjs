// End-to-end checks for the notification list, against the real built
// extension. Run: node scripts/e2e-notifications.mjs dist/chromium
// Chromium must be headed — headless does not start MV3 service workers.
import { chromium } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXT = process.argv[2] ?? 'dist/chromium'
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'sb118-')), {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
const id = new URL(sw.url()).host
const POPUP = `chrome-extension://${id}/popup/popup.html`

let failed = 0
const check = (ok, msg) => { if (!ok) { console.error('FAIL:', msg); failed++ } else console.log('ok —', msg) }

const iso = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const seed = async (page, state) => page.evaluate(
  (s) => new Promise((r) => chrome.storage.local.set(s, r)), state)
const read = async (page, key) => page.evaluate(
  (k) => new Promise((r) => chrome.storage.local.get(k, (o) => r(o[k]))), key)

const open = async () => { const p = await ctx.newPage(); await p.goto(POPUP); return p }

// 1. Rows render, newest first, with only the unread ones dotted.
{
  const page = await open()
  await seed(page, {
    notifItems: { news: { items: [
      { id: 'new1', title: 'Newer news', url: 'https://x/new1', at: iso(1) },
      { id: 'old1', title: 'Older news', url: 'https://x/old1', at: iso(48) },
    ] } },
    notifLastSeen: { news: iso(24) },
  })
  await page.reload()
  await page.waitForSelector('#notiflist .n-row')
  const ids = await page.$$eval('#notiflist .n-row', (rows) => rows.map((r) => r.className))
  check(ids.length === 2, 'two rows render')
  check(ids[0].includes('is-new') && !ids[1].includes('is-new'), 'only the unread row is dotted')
  const href = await page.$eval('#notiflist .n-row', (r) => r.getAttribute('href'))
  check(href === 'https://x/new1', 'the row links to the item url')
  await page.close()
}

// 2. The marker is advanced from the RENDERED snapshot, not a later cache.
{
  const page = await open()
  await seed(page, {
    notifItems: { news: { items: [{ id: 'a', title: 'A', url: 'https://x/a', at: iso(5) }] } },
    notifLastSeen: {},
  })
  await page.reload()
  await page.waitForSelector('#notiflist .n-row')
  // Something the member never saw arrives while the popup is open.
  await seed(page, { notifItems: { news: { items: [
    { id: 'a', title: 'A', url: 'https://x/a', at: iso(5) },
    { id: 'b', title: 'B', url: 'https://x/b', at: iso(1) },
  ] } } })
  await page.close()

  const next = await open()
  await next.waitForSelector('#notiflist .n-row')
  const rows = await next.$$eval('#notiflist .n-row',
    (rs) => rs.map((r) => ({ id: r.getAttribute('href'), isNew: r.className.includes('is-new') })))
  check(rows.find((r) => r.id === 'https://x/b')?.isNew === true,
    'an item that arrived unseen is still unread on the next open')
  await next.close()
}

// 3. Empty states, each distinct.
for (const [label, state, expected] of [
  ['no cache at all', { notifLastSeen: {} }, 'Checking for updates…'],
  ['a corrupt cache', { notifItems: 'garbage' }, 'Checking for updates…'],
  ['a healthy empty cache', { notifItems: {} }, 'Nothing new right now.'],
  ['every source unavailable', { notifItems: {
    news: { items: [], unavailable: true }, sims: { items: [], unavailable: true },
    announcements: { items: [], unavailable: true } } },
    'Couldn’t reach HQ — this list may be out of date.'],
]) {
  const page = await open()
  await page.evaluate(() => new Promise((r) => chrome.storage.local.clear(r)))
  await seed(page, state)
  await page.reload()
  await page.waitForSelector('#notiflist .n-note')
  const text = await page.$eval('#notiflist .n-note', (n) => n.textContent)
  check(text === expected, `${label} → "${expected}"`)
  await page.close()
}

// 4. Every source switched off hides the section rather than showing an outage.
{
  const page = await open()
  await page.evaluate(() => new Promise((r) => chrome.storage.local.clear(r)))
  await seed(page, {
    notifItems: {}, prefs: { notifications: { news: false, sims: false, announcements: false } },
  })
  await page.reload()
  // 'attached', not the default 'visible' — this check expects it hidden.
  await page.waitForSelector('#notifs', { state: 'attached' })
  check(await page.$eval('#notifs', (s) => s.hidden), 'the section is hidden when all sources are off')
  await page.close()
}

await ctx.close()
console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: PASS')
process.exit(failed ? 1 : 0)

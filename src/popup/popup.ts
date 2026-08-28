import browser from 'webextension-polyfill'
import { MEMBER_LINKS, STAFF_LINKS } from '@/lib/launcher'
import { getPins, addPin, removePin, renamePin, normalizePinUrl } from '@/lib/pins'
import { buildPinChip } from '@/lib/pin-chip'
import { getProfile } from '@/lib/session'
import { getPrefs, enabledSources } from '@/lib/prefs'
import { buildFeedbackUrl } from '@/lib/feedback-link'
import { getNav, syncNavCache } from '@/lib/nav-cache'
import { destinationGroup } from '@/lib/destinations'
import { runSearch, pendingSources, type SearchContext } from '@/lib/search'
import {
  addClicked,
  clickedKey,
  getCachedCount,
  getCachedItems,
  getClicked,
  getLastSeen,
  pruneClicked,
  setLastSeen,
} from '@/lib/notifications-store'
import { advanceLastSeen, badgeText } from '@/lib/notification-count'
import {
  buildNotificationList,
  selectDefaultTab,
  type DisplayItem,
  type PopupTab,
} from '@/lib/notification-list'
import {
  SOURCE_LABELS as NOTIF_SOURCE_LABELS,
  type LastSeen,
  type NotificationSource,
  type NotificationsResponse,
} from '@/lib/notifications-types'
import { mountTabStrip } from '@/popup/tab-strip'
import {
  DEBOUNCE_MS,
  SOURCE_LABELS,
  SOURCE_ORDER,
  type SearchGroup,
  type SearchHit,
  type SearchSource,
} from '@/lib/search-types'

function openUrl(url: string) {
  browser.tabs.create({ url })
  window.close()
}

/**
 * Shared builder for the plain links the popup renders (grid tiles, "my
 * stuff" chips, staff grid) — an <a> that opens in a new tab via openUrl()
 * instead of navigating the popup itself. Optional `icon`/`prefix` render a
 * leading span/text. Pin chips have their own builder (buildPinChip), since
 * they carry rename and unpin controls.
 */
function renderLink(opts: {
  label: string
  url: string
  className?: string
  icon?: string
  prefix?: string
}): HTMLAnchorElement {
  const a = document.createElement('a')
  if (opts.className) a.className = opts.className
  a.href = opts.url
  if (opts.icon) {
    const ic = document.createElement('span')
    ic.className = 'ic'
    ic.textContent = opts.icon
    a.appendChild(ic)
  }
  a.appendChild(document.createTextNode((opts.prefix ?? '') + opts.label))
  a.addEventListener('click', (e) => { e.preventDefault(); openUrl(opts.url) })
  return a
}

function renderGrid(el: HTMLElement, links: { label: string; url: string; icon?: string }[], className?: string) {
  el.innerHTML = ''
  for (const l of links) el.appendChild(renderLink({ label: l.label, url: l.url, icon: l.icon, className }))
}

async function renderPins() {
  const box = document.getElementById('pinchips')!
  box.innerHTML = ''
  for (const p of await getPins()) {
    box.appendChild(buildPinChip(p, {
      onOpen: openUrl,
      onRemove: async (url) => { await removePin(url); renderPins() },
      onRename: async (url, label) => { await renamePin(url, label); renderPins() },
    }))
  }
  const add = document.createElement('button'); add.className = 'chip add'; add.textContent = '＋ Pin tab'
  add.addEventListener('click', async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.url) { await addPin({ label: tab.title ?? tab.url, url: tab.url }); renderPins() }
  })

  const manual = document.createElement('button')
  manual.className = 'chip add'
  manual.textContent = '＋ Add link'
  manual.title = 'Pin a page you are not currently on'
  manual.addEventListener('click', () => { openManualPinForm(box, manual) })

  box.append(add, manual)
}

/**
 * The "＋ Add link" form: a name and an address, added in place of the button.
 *
 * "Pin tab" only reaches the page you happen to be on, which is no help for
 * the pages a member wants at hand *while* they are somewhere else — PNPC wiki
 * pages were the staff-test example. This is the same storage as a pinned tab,
 * so it renames and unpins identically; the only new thing is that the address
 * is typed rather than read off the tab, which is why it goes through
 * normalizePinUrl() before it is stored.
 */
function openManualPinForm(box: HTMLElement, trigger: HTMLElement): void {
  if (box.querySelector('.pin-form')) return

  const form = document.createElement('form')
  form.className = 'pin-form'

  const name = document.createElement('input')
  name.type = 'text'
  name.placeholder = 'Name'
  name.setAttribute('aria-label', 'Link name')

  const url = document.createElement('input')
  url.type = 'text'
  url.placeholder = 'wiki.starbase118.net/…'
  url.setAttribute('aria-label', 'Link address')

  const save = document.createElement('button')
  save.type = 'submit'
  save.className = 'chip add'
  save.textContent = 'Add'

  form.append(name, url, save)

  const cancel = () => { form.replaceWith(trigger) }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const normalized = normalizePinUrl(url.value)
    if (!normalized) {
      // Keep what they typed — retyping the whole address to fix a typo is
      // worse than an invalid field that says so.
      url.classList.add('invalid')
      url.focus()
      return
    }
    await addPin({ label: name.value.trim() || normalized, url: normalized })
    renderPins()
  })
  url.addEventListener('input', () => { url.classList.remove('invalid') })
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  })

  trigger.replaceWith(form)
  name.focus()
}

/* ---------------------------------------------------------------- search */

/**
 * Search state. `groups` is keyed by source so a late-arriving response
 * replaces its own group and nothing else; `pending` is what we are still
 * waiting on, so a slow source reads as "searching" rather than "no matches".
 */
const search = {
  ctx: { signedIn: false, isStaff: false, nav: [] } as SearchContext,
  query: '',
  groups: new Map<SearchSource, SearchGroup>(),
  pending: new Set<SearchSource>(),
  hits: [] as SearchHit[],
  sel: -1,
  controller: null as AbortController | null,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
}

function groupHead(source: SearchSource, seeAllUrl: string | null): HTMLElement {
  const head = document.createElement('div')
  head.className = 'r-head'
  const lbl = document.createElement('span')
  lbl.className = 'lbl'
  lbl.textContent = SOURCE_LABELS[source]
  head.appendChild(lbl)
  if (seeAllUrl) {
    const a = document.createElement('a')
    a.className = 'r-seeall'
    a.href = seeAllUrl
    a.textContent = 'See all →'
    a.addEventListener('click', (e) => { e.preventDefault(); openUrl(seeAllUrl) })
    head.appendChild(a)
  }
  return head
}

function note(text: string, warn = false): HTMLElement {
  const el = document.createElement('div')
  el.className = warn ? 'r-note warn' : 'r-note'
  el.textContent = text
  return el
}

function hitRow(hit: SearchHit): HTMLAnchorElement {
  const a = document.createElement('a')
  a.className = 'r-hit'
  a.href = hit.url
  a.setAttribute('role', 'option')
  const t = document.createElement('span'); t.className = 't'; t.textContent = hit.title
  a.appendChild(t)
  if (hit.snippet) {
    const s = document.createElement('span'); s.className = 's'; s.textContent = hit.snippet
    a.appendChild(s)
  }
  a.addEventListener('click', (e) => { e.preventDefault(); openUrl(hit.url) })
  return a
}

function renderResults() {
  const box = document.getElementById('results')!
  box.innerHTML = ''
  search.hits = []

  // Sources that answered with nothing are collapsed into one trailing line
  // rather than four empty headings — the distinction between "searched,
  // found nothing" and "not applicable" is kept, without the noise.
  const empty: SearchSource[] = []

  for (const source of SOURCE_ORDER) {
    const group = search.groups.get(source)

    if (!group) {
      if (!search.pending.has(source)) continue
      const sec = document.createElement('div')
      sec.className = 'r-group'
      sec.append(groupHead(source, null), note('Searching…'))
      box.appendChild(sec)
      continue
    }

    if (group.unavailable) {
      const sec = document.createElement('div')
      sec.className = 'r-group'
      sec.append(
        groupHead(source, group.seeAllUrl),
        note(`${SOURCE_LABELS[source]} unavailable`, true)
      )
      box.appendChild(sec)
      continue
    }

    if (!group.hits.length) { empty.push(source); continue }

    const sec = document.createElement('div')
    sec.className = 'r-group'
    sec.appendChild(groupHead(source, group.seeAllUrl))
    for (const hit of group.hits) {
      search.hits.push(hit)
      sec.appendChild(hitRow(hit))
    }
    box.appendChild(sec)
  }

  if (empty.length) {
    box.appendChild(note(`No matches in ${empty.map((s) => SOURCE_LABELS[s].toLowerCase()).join(', ')}.`))
  }

  if (!search.ctx.signedIn) {
    const line = document.createElement('div')
    line.className = 'r-signin'
    const a = document.createElement('a')
    a.href = 'https://hq.starbase118.net/login'
    a.textContent = 'Sign in to HQ'
    a.addEventListener('click', (e) => { e.preventDefault(); openUrl('https://hq.starbase118.net/login') })
    line.append(a, document.createTextNode(' to also search HQ pages and the staff forum.'))
    box.appendChild(line)
  }

  applySelection()
}

function applySelection() {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.r-hit'))
  if (search.sel >= search.hits.length) search.sel = search.hits.length - 1
  rows.forEach((row, i) => row.classList.toggle('sel', i === search.sel))
  if (search.sel >= 0) rows[search.sel]?.scrollIntoView({ block: 'nearest' })
}

function showLauncher() {
  document.getElementById('results')!.hidden = true
  document.getElementById('launcher')!.hidden = false
}

function showResults() {
  document.getElementById('launcher')!.hidden = true
  document.getElementById('results')!.hidden = false
}

function onQueryChanged(raw: string) {
  search.query = raw
  search.controller?.abort()
  clearTimeout(search.timer)

  const q = raw.trim()
  if (!q) {
    search.groups.clear()
    search.pending.clear()
    search.sel = -1
    showLauncher()
    return
  }

  search.groups.clear()
  search.pending = new Set(pendingSources(q, search.ctx))
  search.sel = -1
  showResults()

  // Destinations are local — they go up before the debounce, not after it.
  if (search.ctx.nav.length) {
    search.groups.set('destination', destinationGroup(search.ctx.nav, q))
    search.pending.delete('destination')
  }
  renderResults()

  const controller = new AbortController()
  search.controller = controller
  search.timer = setTimeout(() => {
    void runSearch(q, search.ctx, {
      signal: controller.signal,
      onGroup: (group) => {
        if (controller.signal.aborted) return
        search.groups.set(group.source, group)
        search.pending.delete(group.source)
        renderResults()
      },
    }).finally(() => {
      if (controller.signal.aborted) return
      search.pending.clear()
      renderResults()
    })
  }, DEBOUNCE_MS)
}

function wireSearch() {
  const input = document.getElementById('search') as HTMLInputElement
  input.disabled = false
  input.addEventListener('input', () => onQueryChanged(input.value))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = ''
      onQueryChanged('')
      return
    }
    if (e.key === 'Enter') {
      const hit = search.hits[search.sel >= 0 ? search.sel : 0]
      if (hit) { e.preventDefault(); openUrl(hit.url) }
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (!search.hits.length) return
    e.preventDefault()
    const step = e.key === 'ArrowDown' ? 1 : -1
    search.sel = (search.sel + step + search.hits.length) % search.hits.length
    applySelection()
  })
  input.focus()
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
  ['hour', 3600000], ['minute', 60000],
]

/**
 * A relative time, or null when the timestamp will not parse — passing NaN to
 * the formatter yields "NaN days ago" or throws mid-render. The item is still
 * listed and still clickable; only its time is missing, because only its time
 * is broken.
 */
function relativeTime(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const diff = ms - Date.now()
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return RELATIVE.format(Math.round(diff / size), unit)
  }
  return RELATIVE.format(0, 'minute')
}

function buildNotifRow(item: DisplayItem): HTMLAnchorElement {
  const a = document.createElement('a')
  a.className = item.isNew ? 'n-row is-new' : 'n-row'
  a.href = item.url
  a.title = item.title

  const dot = document.createElement('span')
  dot.className = 'n-dot'
  if (item.isNew) dot.setAttribute('aria-label', 'New')

  const body = document.createElement('span')
  body.className = 'n-body'

  const title = document.createElement('span')
  title.className = 'n-title'
  title.textContent = item.title

  const meta = document.createElement('span')
  meta.className = 'n-meta'
  const src = document.createElement('span')
  src.className = 'n-src'
  src.textContent = NOTIF_SOURCE_LABELS[item.source]
  meta.appendChild(src)
  const when = relativeTime(item.at)
  if (when) meta.appendChild(document.createTextNode(` · ${when}`))

  body.append(title, meta)
  a.append(dot, body)
  // NOT openUrl(): that calls window.close() on the same synchronous turn, and
  // addClicked is a read-modify-write whose set() is only issued after its
  // get() resolves — by which point this context is gone and the write is
  // dropped. Tab first so the member sees no delay, then the write, awaited,
  // then close.
  a.addEventListener('click', async (e) => {
    e.preventDefault()
    browser.tabs.create({ url: item.url })
    await addClicked(clickedKey(item.source, item.id)).catch(() => {})
    window.close()
  })
  return a
}

function notifNote(text: string): HTMLElement {
  const p = document.createElement('div')
  p.className = 'n-note'
  p.textContent = text
  return p
}

/**
 * The exact payload the panel rendered, held for showNotifs().
 *
 * The marker must advance against THIS snapshot, never a fresh storage read —
 * a worker poll landing between the render and the member clicking the tab
 * would otherwise mark an item seen that was never on screen. Same reasoning
 * that moved this write out of the worker in Phase 3.1.
 */
let rendered: {
  cached: NotificationsResponse['sources']
  lastSeen: LastSeen
  enabled: NotificationSource[]
} | null = null

async function renderNotifications(): Promise<void> {
  const box = document.getElementById('notiflist')!
  box.innerHTML = ''

  const [cached, prefs, clicked] = await Promise.all([getCachedItems(), getPrefs(), getClicked()])
  const enabled = enabledSources(prefs)
  if (!enabled.length) return

  if (cached === null) {
    box.appendChild(notifNote('Checking for updates…'))
    void browser.runtime.sendMessage({ type: 'notif:refresh' }).catch(() => {})
    return
  }

  const lastSeen = await getLastSeen()
  const { items, state } = buildNotificationList(cached, lastSeen, enabled, new Set(clicked))

  if (state === 'disabled') return
  if (state === 'outage') {
    box.appendChild(notifNote('Couldn’t reach HQ — this list may be out of date.'))
    return
  }
  if (!items.length) {
    box.appendChild(notifNote('Nothing new right now.'))
  } else {
    for (const item of items) box.appendChild(buildNotifRow(item))
  }

  // Only what was actually rendered, and only now.
  rendered = { cached, lastSeen, enabled }

  // Keys whose item has aged out of a HEALTHY source can go; a sick source
  // keeps everything it has.
  void pruneClicked(cached).catch(() => {})
}

/* ----------------------------------------------------------- launcher UI */

async function personalize() {
  const [profile, prefs] = await Promise.all([getProfile(), getPrefs()])

  // Render destinations from the cache first, then reconcile: a cold popup
  // can search HQ pages before /api/me answers, and the sync below clears the
  // cache outright if the session has since ended.
  search.ctx.nav = await getNav()
  search.ctx.signedIn = !!profile
  search.ctx.isStaff = !!profile?.isStaff
  search.ctx.nav = await syncNavCache(profile)

  const light = document.getElementById('login')!
  if (!profile) {
    light.classList.add('off')
    light.textContent = 'Signed out'
    document.getElementById('ph')!.addEventListener('click', () => openUrl('https://hq.starbase118.net/login'))
    return
  }

  const mine = document.getElementById('mychips')!
  /**
   * A chip with no wiki URL renders as plain text, not a link to HQ's front
   * page. Falling back to the dashboard made a missing `ship.wikiUrl` look
   * like a working link that goes somewhere unrelated — reported in the staff
   * test round, where clicking a ship name landed on the HQ dashboard.
   */
  const addChip = (emoji: string, name: string | null, url: string | null) => {
    if (!name) return
    if (!url) {
      const span = document.createElement('span')
      span.className = 'chip nolink'
      span.title = `No wiki page on file for ${name}`
      span.textContent = `${emoji} ${name}`
      mine.appendChild(span)
      return
    }
    mine.appendChild(renderLink({ label: name, url, className: 'chip', prefix: `${emoji} ` }))
  }
  addChip('👤', profile.character?.name ?? null, profile.character?.wikiUrl ?? prefs.manualCharacterUrl ?? null)
  addChip('🚀', profile.ship?.name ?? null, profile.ship?.wikiUrl ?? prefs.manualShipUrl ?? null)
  if (mine.children.length) document.getElementById('mystuff')!.hidden = false

  if (profile.isStaff) {
    renderGrid(document.getElementById('staffgrid')!, STAFF_LINKS, 'chip')
    document.getElementById('staff')!.hidden = false
  }
}

/**
 * "Report an issue on this page" — opens HQ's report form in a new tab with
 * the current tab's URL and title carried over.
 *
 * The wiki, main site and staff forum open the panel in place. Here we leave
 * the page instead; see buildFeedbackUrl() for why that trade is deliberate
 * rather than a shortcut.
 */
function wireReportIssue() {
  document.getElementById('report-issue')!.addEventListener('click', async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    openUrl(buildFeedbackUrl(tab?.url ?? '', tab?.title ?? ''))
  })
}

/**
 * Advance the marker because the panel is now on screen.
 *
 * "Seen" means visible, not rendered — the panel renders on every open,
 * including opens that land on Launcher, and clearing the badge for someone
 * who never looked loses information silently.
 *
 * The write is AWAITED before notif:refresh: the worker recomputes the badge
 * from stored state, so a refresh racing ahead of the write counts against the
 * old marker and puts the number straight back.
 */
async function markNotifsSeen(): Promise<void> {
  if (!rendered) return
  const { cached, lastSeen, enabled } = rendered
  await setLastSeen(advanceLastSeen(lastSeen, cached, enabled))
  void browser.runtime.sendMessage({ type: 'notif:refresh' }).catch(() => {
    // The worker may be asleep; the next alarm reconciles the badge.
  })
}

async function mountTabs(): Promise<void> {
  const [prefs, count] = await Promise.all([getPrefs(), getCachedCount()])
  const enabled = enabledSources(prefs)

  // Every source switched off: no strip at all, the launcher is the popup.
  if (!enabled.length) {
    document.getElementById('tab-notifs')!.hidden = true
    return
  }

  const strip = document.getElementById('tabs')!
  strip.hidden = false

  const pill = document.getElementById('tab-count')!
  const text = badgeText(count)
  pill.textContent = text
  pill.hidden = !text

  const tabs = mountTabStrip(
    {
      strip,
      launcherBtn: document.getElementById('tab-launcher-btn') as HTMLButtonElement,
      notifsBtn: document.getElementById('tab-notifs-btn') as HTMLButtonElement,
      launcherPanel: document.getElementById('tab-launcher')!,
      notifsPanel: document.getElementById('tab-notifs')!,
    },
    { onShow: (tab: PopupTab) => { if (tab === 'notifs') void markNotifsSeen() } }
  )

  tabs.show(selectDefaultTab(count, enabled.length))
}

document.addEventListener('DOMContentLoaded', () => {
  renderGrid(document.getElementById('grid')!, MEMBER_LINKS)
  wireReportIssue()
  wireSearch()
  // The strip mounts only after renderNotifications() has filled the panel and
  // set `rendered` — showing the tab is what advances the marker, so there must
  // be a snapshot to advance against.
  //
  // allSettled, not all: these three already failed independently of each other,
  // and `all` would let a rejection in renderPins() — nothing to do with
  // notifications — skip mountTabs entirely, leaving both #tabs and #tab-notifs
  // hidden. That degrades the popup to launcher-only with no way to reach the
  // notifications and nothing on screen to say why.
  void Promise.allSettled([renderPins(), personalize(), renderNotifications()]).then(mountTabs)
})

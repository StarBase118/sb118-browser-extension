import browser from 'webextension-polyfill'
import { MEMBER_LINKS, STAFF_LINKS } from '@/lib/launcher'
import { getPins, addPin, removePin, renamePin, normalizePinUrl } from '@/lib/pins'
import { buildPinChip } from '@/lib/pin-chip'
import { getProfile } from '@/lib/session'
import { getPrefs, setPrefs } from '@/lib/prefs'
import { buildFeedbackUrl } from '@/lib/feedback-link'
import { getNav, syncNavCache } from '@/lib/nav-cache'
import { destinationGroup } from '@/lib/destinations'
import { runSearch, pendingSources, type SearchContext } from '@/lib/search'
import { getCachedCount } from '@/lib/notifications-store'
import { SOURCE_LABELS as NOTIF_SOURCE_LABELS } from '@/lib/notifications-types'
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

async function renderNotificationIntro() {
  const count = await getCachedCount()
  const prefs = await getPrefs()

  // Wait for the first non-zero badge before explaining it; showing this on
  // install would describe a number the member has not seen yet.
  if (count <= 0 || prefs.notifIntroDismissed === true) return

  const box = document.getElementById('notif-intro')!
  box.innerHTML = ''

  const text = document.createElement('span')
  text.textContent = `The badge counts new ${NOTIF_SOURCE_LABELS.announcements}, ${NOTIF_SOURCE_LABELS.sims}, and ${NOTIF_SOURCE_LABELS.news}. You can switch any source off in `

  const options = document.createElement('a')
  options.href = '#'
  options.textContent = 'notification settings'
  options.addEventListener('click', async (e) => {
    e.preventDefault()
    await browser.runtime.openOptionsPage()
  })

  const suffix = document.createElement('span')
  suffix.textContent = '.'

  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = 'Dismiss'
  dismiss.addEventListener('click', async () => {
    await setPrefs({ notifIntroDismissed: true })
    box.hidden = true
  })

  box.append(text, options, suffix, dismiss)
  box.hidden = false
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

  const anns = profile.announcements ?? []
  if (anns.length) {
    const box = document.getElementById('annlist')!
    for (const ann of anns as Array<{ title: string; url?: string }>) {
      const row = document.createElement('div'); row.className = 'a-item'
      const dot = document.createElement('span'); dot.className = 'a-dot'; dot.textContent = '◆'
      // Same rule as the "my stuff" chips: an announcement with no URL is text,
      // not an <a href="#"> that looks clickable and goes nowhere.
      const url = ann.url
      const label = document.createElement(url ? 'a' : 'span')
      label.textContent = ann.title
      label.style.color = 'inherit'; label.style.textDecoration = 'none'
      if (url) {
        ;(label as HTMLAnchorElement).href = url
        label.addEventListener('click', (e) => { e.preventDefault(); openUrl(url) })
      }
      row.append(dot, label); box.appendChild(row)
    }
    document.getElementById('announce')!.hidden = false
  }

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

document.addEventListener('DOMContentLoaded', () => {
  renderGrid(document.getElementById('grid')!, MEMBER_LINKS)
  wireReportIssue()
  wireSearch()
  Promise.all([renderPins(), personalize()])
  void renderNotificationIntro().finally(() => {
    void browser.runtime.sendMessage({ type: 'notif:seen' }).catch(() => {
      // The worker may be asleep; the next alarm reconciles storage and badge.
    })
  })
})

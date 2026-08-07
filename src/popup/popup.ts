import browser from 'webextension-polyfill'
import { MEMBER_LINKS, STAFF_LINKS } from '@/lib/launcher'
import { getPins, addPin, removePin } from '@/lib/pins'
import { getProfile } from '@/lib/session'
import { getPrefs } from '@/lib/prefs'
import { buildFeedbackUrl } from '@/lib/feedback-link'
import { getNav, syncNavCache } from '@/lib/nav-cache'
import { destinationGroup } from '@/lib/destinations'
import { runSearch, pendingSources, type SearchContext } from '@/lib/search'
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
 * Shared builder for every clickable link the popup renders (grid tiles,
 * pin chips, "my stuff" chips, staff grid) — a plain <a> or <span>+<a> that
 * opens in a new tab via openUrl() instead of navigating the popup itself.
 * Optional `icon`/`prefix` render a leading span/text; `onRemove` adds a
 * trailing ✕ button (used by pin chips).
 */
function renderLink(opts: {
  label: string
  url: string
  className?: string
  icon?: string
  prefix?: string
  onRemove?: () => void | Promise<void>
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
  if (opts.onRemove) {
    const x = document.createElement('button'); x.textContent = '✕'; x.className = 'x'
    x.addEventListener('click', async (e) => { e.stopPropagation(); e.preventDefault(); await opts.onRemove!() })
    a.appendChild(x)
  }
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
    box.appendChild(renderLink({
      label: p.label,
      url: p.url,
      className: 'chip',
      prefix: '★ ',
      onRemove: async () => { await removePin(p.url); renderPins() },
    }))
  }
  const add = document.createElement('button'); add.className = 'chip add'; add.textContent = '＋ Pin tab'
  add.addEventListener('click', async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.url) { await addPin({ label: tab.title ?? tab.url, url: tab.url }); renderPins() }
  })
  box.appendChild(add)
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
  const addChip = (emoji: string, name: string | null, url: string | null) => {
    if (!name) return
    mine.appendChild(renderLink({ label: name, url: url ?? 'https://hq.starbase118.net', className: 'chip', prefix: `${emoji} ` }))
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
      const a = document.createElement('a'); a.textContent = ann.title; a.href = ann.url ?? '#'
      a.style.color = 'inherit'; a.style.textDecoration = 'none'
      if (ann.url) a.addEventListener('click', (e) => { e.preventDefault(); openUrl(ann.url!) })
      row.append(dot, a); box.appendChild(row)
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
})

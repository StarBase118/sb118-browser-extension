import type { PopupTab } from '@/lib/notification-list'

export interface TabStripElements {
  strip: HTMLElement
  launcherBtn: HTMLButtonElement
  notifsBtn: HTMLButtonElement
  launcherPanel: HTMLElement
  notifsPanel: HTMLElement
}

export interface TabStripOptions {
  /** Called every time a tab is shown, including the initial show. */
  onShow?: (tab: PopupTab) => void
}

export interface TabStrip {
  show(tab: PopupTab): void
  current(): PopupTab
}

/**
 * Owns the tab strip: which panel is visible, ARIA state, and keyboard moves.
 *
 * It deliberately does NOT know how to render either panel. Switching tabs
 * must never re-render the notification list — the gold "new" dots are
 * computed once from a marker that has already advanced, so a re-render would
 * clear them mid-visit. Visibility only.
 */
export function mountTabStrip(el: TabStripElements, opts: TabStripOptions = {}): TabStrip {
  let current: PopupTab = 'launcher'

  function show(tab: PopupTab): void {
    current = tab
    const onNotifs = tab === 'notifs'

    el.notifsPanel.hidden = !onNotifs
    el.launcherPanel.hidden = onNotifs

    // Roving tabindex: one Tab press moves into the panel rather than walking
    // across the other tab button.
    el.launcherBtn.setAttribute('aria-selected', String(!onNotifs))
    el.launcherBtn.tabIndex = onNotifs ? -1 : 0
    el.notifsBtn.setAttribute('aria-selected', String(onNotifs))
    el.notifsBtn.tabIndex = onNotifs ? 0 : -1

    opts.onShow?.(tab)
  }

  el.launcherBtn.addEventListener('click', () => show('launcher'))
  el.notifsBtn.addEventListener('click', () => show('notifs'))

  el.strip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    // Two tabs, so either arrow means "the other one". Automatic activation:
    // arriving is choosing.
    const next: PopupTab = current === 'launcher' ? 'notifs' : 'launcher'
    show(next)
    ;(next === 'notifs' ? el.notifsBtn : el.launcherBtn).focus()
  })

  return { show, current: () => current }
}

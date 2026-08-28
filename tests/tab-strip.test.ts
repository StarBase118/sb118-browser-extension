import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountTabStrip } from '@/popup/tab-strip'

function fixture() {
  document.body.innerHTML = `
    <div id="tabs">
      <button id="lb" role="tab" aria-controls="lp" aria-selected="true">Launcher</button>
      <button id="nb" role="tab" aria-controls="np" aria-selected="false">New for you</button>
    </div>
    <div id="lp">launcher panel</div>
    <div id="np" hidden>notifs panel</div>`
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  return {
    strip: $('tabs'),
    launcherBtn: $<HTMLButtonElement>('lb'),
    notifsBtn: $<HTMLButtonElement>('nb'),
    launcherPanel: $('lp'),
    notifsPanel: $('np'),
  }
}

beforeEach(() => { document.body.innerHTML = '' })

describe('tab strip', () => {
  it('shows one panel and hides the other', () => {
    const el = fixture()
    const strip = mountTabStrip(el)
    strip.show('notifs')
    expect(el.notifsPanel.hidden).toBe(false)
    expect(el.launcherPanel.hidden).toBe(true)
    expect(strip.current()).toBe('notifs')

    strip.show('launcher')
    expect(el.launcherPanel.hidden).toBe(false)
    expect(el.notifsPanel.hidden).toBe(true)
  })

  it('keeps aria-selected and roving tabindex in step', () => {
    const el = fixture()
    mountTabStrip(el).show('notifs')
    expect(el.notifsBtn.getAttribute('aria-selected')).toBe('true')
    expect(el.launcherBtn.getAttribute('aria-selected')).toBe('false')
    expect(el.notifsBtn.tabIndex).toBe(0)
    expect(el.launcherBtn.tabIndex).toBe(-1)
  })

  it('switches on click', () => {
    const el = fixture()
    mountTabStrip(el)
    el.notifsBtn.click()
    expect(el.notifsPanel.hidden).toBe(false)
  })

  // Automatic activation: with two tabs, arriving IS choosing.
  it('activates and focuses on arrow keys', () => {
    const el = fixture()
    mountTabStrip(el)
    el.launcherBtn.focus()
    el.launcherBtn.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    )
    expect(el.notifsPanel.hidden).toBe(false)
    expect(document.activeElement).toBe(el.notifsBtn)

    el.notifsBtn.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
    )
    expect(el.launcherPanel.hidden).toBe(false)
    expect(document.activeElement).toBe(el.launcherBtn)
  })

  it('calls onShow every time a tab is shown', () => {
    const el = fixture()
    const onShow = vi.fn()
    const strip = mountTabStrip(el, { onShow })
    strip.show('notifs')
    strip.show('launcher')
    strip.show('notifs')
    expect(onShow.mock.calls.map((c) => c[0])).toEqual(['notifs', 'launcher', 'notifs'])
  })

  /**
   * Decision 3 of the spec, asserted at this module's boundary.
   *
   * The gold "new" dots are computed once, at render, from a marker that has
   * already advanced by the time a tab can be clicked. If switching tabs
   * re-rendered the panel, every dot would vanish mid-visit. This module must
   * therefore never write panel content — only visibility.
   */
  it('never touches panel content', () => {
    const el = fixture()
    el.notifsPanel.innerHTML = '<a class="n-row is-new">a sim</a>'
    const before = el.notifsPanel.innerHTML
    const strip = mountTabStrip(el)
    strip.show('notifs')
    strip.show('launcher')
    strip.show('notifs')
    el.notifsBtn.click()
    expect(el.notifsPanel.innerHTML).toBe(before)
  })
})

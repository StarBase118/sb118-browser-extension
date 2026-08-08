import browser from 'webextension-polyfill'
import { getPrefs, setPrefs, type Prefs } from '@/lib/prefs'
import { getPins, removePin } from '@/lib/pins'
import { ALL_SOURCES, SOURCE_LABELS, type NotificationSource } from '@/lib/notifications-types'

const NOTIFICATION_IDS: Record<NotificationSource, string> = {
  announcements: 'notif-announcements',
  sims: 'notif-sims',
  news: 'notif-news',
}

function showSaved() {
  const s = document.getElementById('saved')!
  s.hidden = false
  setTimeout(() => { s.hidden = true }, 1500)
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function notificationPrefs(p: Prefs): Partial<Record<NotificationSource, boolean>> {
  return isPlainRecord(p.notifications) ? p.notifications : {}
}

function notificationInput(source: NotificationSource): HTMLInputElement {
  return document.getElementById(NOTIFICATION_IDS[source]) as HTMLInputElement
}

async function loadPrefs() {
  const p = await getPrefs()
  ;(document.getElementById('char') as HTMLInputElement).value = p.manualCharacterUrl ?? ''
  ;(document.getElementById('ship') as HTMLInputElement).value = p.manualShipUrl ?? ''

  const notifications = notificationPrefs(p)
  for (const source of ALL_SOURCES) {
    document.getElementById(`${NOTIFICATION_IDS[source]}-label`)!.textContent = SOURCE_LABELS[source]
    notificationInput(source).checked = notifications[source] !== false
  }
}

function wireNotificationPrefs() {
  for (const source of ALL_SOURCES) {
    notificationInput(source).addEventListener('change', async () => {
      const current = await getPrefs()
      await setPrefs({
        notifications: {
          ...notificationPrefs(current),
          [source]: notificationInput(source).checked,
        },
      })
      showSaved()
      try {
        await browser.runtime.sendMessage({ type: 'notif:refresh' })
      } catch {
        // The worker may be asleep; the next alarm reconciles the badge.
      }
    })
  }
}

async function loadPins() {
  const ul = document.getElementById('pinlist')!
  ul.innerHTML = ''
  const pins = await getPins()
  if (!pins.length) { ul.innerHTML = '<li>No pinned links yet.</li>'; return }
  for (const p of pins) {
    const li = document.createElement('li')
    const a = document.createElement('a'); a.href = p.url; a.textContent = p.label; a.target = '_blank'; a.rel = 'noreferrer'
    const btn = document.createElement('button'); btn.textContent = 'Remove'
    btn.addEventListener('click', async () => { await removePin(p.url); loadPins() })
    li.append(a, btn); ul.appendChild(li)
  }
}
document.getElementById('prefs')!.addEventListener('submit', async (e) => {
  e.preventDefault()
  await setPrefs({
    manualCharacterUrl: (document.getElementById('char') as HTMLInputElement).value.trim() || undefined,
    manualShipUrl: (document.getElementById('ship') as HTMLInputElement).value.trim() || undefined,
  })
  showSaved()
})
document.addEventListener('DOMContentLoaded', () => { loadPrefs(); loadPins(); wireNotificationPrefs() })

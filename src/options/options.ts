import { getPrefs, setPrefs } from '@/lib/prefs'
import { getPins, removePin } from '@/lib/pins'

async function loadPrefs() {
  const p = await getPrefs()
  ;(document.getElementById('char') as HTMLInputElement).value = p.manualCharacterUrl ?? ''
  ;(document.getElementById('ship') as HTMLInputElement).value = p.manualShipUrl ?? ''
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
  const s = document.getElementById('saved')!; s.hidden = false; setTimeout(() => { s.hidden = true }, 1500)
})
document.addEventListener('DOMContentLoaded', () => { loadPrefs(); loadPins() })

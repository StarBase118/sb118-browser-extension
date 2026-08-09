import type { Pin } from '@/lib/pins'

export interface PinChipHandlers {
  /** Open the pinned page (the popup's openUrl). */
  onOpen: (url: string) => void
  /** Unpin. The caller re-renders. */
  onRemove: (url: string) => void | Promise<void>
  /** Commit a new label. The caller re-renders. */
  onRename: (url: string, label: string) => void | Promise<void>
}

/**
 * One pin chip: the star, the label, a rename button and an unpin button.
 *
 * Two things here answer staff-test feedback that a pinned tab was unreadable
 * — the label came straight from the page title, so it was often long enough
 * to swamp the chip with no way to tell which page it was:
 *
 * - The label is truncated in CSS (`.chip-label`) rather than in storage, and
 *   the untruncated text is set as the chip's `title`, so hovering still
 *   answers "which page is this".
 * - The ✎ button swaps the label for an input in place. Enter commits, Escape
 *   or blurring cancels. It edits in place rather than calling `prompt()`,
 *   because a modal dialog raised from a browser-action popup can dismiss the
 *   popup underneath it.
 */
export function buildPinChip(pin: Pin, handlers: PinChipHandlers): HTMLElement {
  const a = document.createElement('a')
  a.className = 'chip'
  a.href = pin.url
  a.title = pin.label

  const star = document.createElement('span')
  star.className = 'chip-star'
  star.textContent = '★'

  const label = document.createElement('span')
  label.className = 'chip-label'
  label.textContent = pin.label

  a.append(star, label)
  a.addEventListener('click', (e) => {
    e.preventDefault()
    handlers.onOpen(pin.url)
  })

  const edit = document.createElement('button')
  edit.className = 'edit'
  edit.textContent = '✎'
  edit.title = 'Rename this pin'
  edit.setAttribute('aria-label', `Rename ${pin.label}`)
  edit.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    startEditing(a, label, pin, handlers)
  })

  const x = document.createElement('button')
  x.className = 'x'
  x.textContent = '✕'
  x.title = 'Unpin'
  x.setAttribute('aria-label', `Unpin ${pin.label}`)
  x.addEventListener('click', async (e) => {
    e.stopPropagation()
    e.preventDefault()
    await handlers.onRemove(pin.url)
  })

  a.append(edit, x)
  return a
}

/**
 * Swap the label span for an input. `done` is guarded so a commit followed by
 * the input's own blur can't fire the handler twice.
 */
function startEditing(
  chip: HTMLElement,
  label: HTMLElement,
  pin: Pin,
  handlers: PinChipHandlers
): void {
  if (chip.querySelector('input')) return

  const input = document.createElement('input')
  input.className = 'chip-edit'
  input.type = 'text'
  input.value = pin.label
  input.setAttribute('aria-label', 'Pin name')

  let settled = false
  const commit = async () => {
    if (settled) return
    settled = true
    await handlers.onRename(pin.url, input.value)
  }
  const cancel = () => {
    if (settled) return
    settled = true
    input.replaceWith(label)
  }

  input.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  })
  input.addEventListener('blur', cancel)

  label.replaceWith(input)
  input.focus()
  input.select()
}

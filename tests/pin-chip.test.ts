import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPinChip } from '@/lib/pin-chip'

const LONG =
  'USS Constitution-B — Mission Archive — Chapter 14: The Long Dark of Betazed'

function handlers() {
  return { onOpen: vi.fn(), onRemove: vi.fn(), onRename: vi.fn() }
}

function mount(label: string, h = handlers()) {
  const chip = buildPinChip({ label, url: 'https://wiki/x' }, h)
  document.body.appendChild(chip)
  return { chip, h }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('buildPinChip', () => {
  it('renders the label in its own truncatable element', () => {
    const { chip } = mount(LONG)
    const label = chip.querySelector('.chip-label')!
    expect(label.textContent).toBe(LONG)
  })

  it('carries the full label as a tooltip, untruncated', () => {
    const { chip } = mount(LONG)
    expect(chip.getAttribute('title')).toBe(LONG)
  })

  it('opens the pinned url on click without navigating the popup', () => {
    const { chip, h } = mount('Wiki')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    chip.dispatchEvent(ev)
    expect(h.onOpen).toHaveBeenCalledWith('https://wiki/x')
    expect(ev.defaultPrevented).toBe(true)
  })

  it('unpins from the ✕ button without also opening the pin', async () => {
    const { chip, h } = mount('Wiki')
    chip.querySelector<HTMLButtonElement>('.x')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    expect(h.onRemove).toHaveBeenCalledWith('https://wiki/x')
    expect(h.onOpen).not.toHaveBeenCalled()
  })

  it('swaps the label for an input when ✎ is clicked, without opening the pin', () => {
    const { chip, h } = mount(LONG)
    chip.querySelector<HTMLButtonElement>('.edit')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    const input = chip.querySelector<HTMLInputElement>('input')!
    expect(input).toBeTruthy()
    expect(input.value).toBe(LONG)
    expect(chip.querySelector('.chip-label')).toBeNull()
    expect(h.onOpen).not.toHaveBeenCalled()
  })

  it('commits the new name on Enter', () => {
    const { chip, h } = mount('Old')
    chip.querySelector<HTMLButtonElement>('.edit')!.click()
    const input = chip.querySelector<HTMLInputElement>('input')!
    input.value = 'Bio'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(h.onRename).toHaveBeenCalledWith('https://wiki/x', 'Bio')
  })

  it('cancels on Escape and puts the original label back', () => {
    const { chip, h } = mount('Old')
    chip.querySelector<HTMLButtonElement>('.edit')!.click()
    const input = chip.querySelector<HTMLInputElement>('input')!
    input.value = 'Discarded'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(h.onRename).not.toHaveBeenCalled()
    expect(chip.querySelector('.chip-label')!.textContent).toBe('Old')
  })

  it('cancels on blur rather than saving a half-typed name', () => {
    const { chip, h } = mount('Old')
    chip.querySelector<HTMLButtonElement>('.edit')!.click()
    const input = chip.querySelector<HTMLInputElement>('input')!
    input.value = 'Half typ'
    input.dispatchEvent(new FocusEvent('blur'))
    expect(h.onRename).not.toHaveBeenCalled()
    expect(chip.querySelector('.chip-label')!.textContent).toBe('Old')
  })

  it('does not rename twice when Enter is followed by the input blurring', () => {
    const { chip, h } = mount('Old')
    chip.querySelector<HTMLButtonElement>('.edit')!.click()
    const input = chip.querySelector<HTMLInputElement>('input')!
    input.value = 'Bio'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur'))
    expect(h.onRename).toHaveBeenCalledTimes(1)
  })

  it('ignores a second ✎ click while already editing', () => {
    const { chip } = mount('Old')
    const edit = chip.querySelector<HTMLButtonElement>('.edit')!
    edit.click()
    const first = chip.querySelector('input')
    edit.click()
    expect(chip.querySelectorAll('input')).toHaveLength(1)
    expect(chip.querySelector('input')).toBe(first)
  })

  it('does not open the pin when the edit field itself is clicked', () => {
    const { chip, h } = mount('Old')
    chip.querySelector<HTMLButtonElement>('.edit')!.click()
    chip.querySelector<HTMLInputElement>('input')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    expect(h.onOpen).not.toHaveBeenCalled()
  })
})

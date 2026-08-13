import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) }),
    } },
  },
}))

import { getPins, addPin, removePin, renamePin, normalizePinUrl, MAX_PIN_LABEL } from '@/lib/pins'

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('pins', () => {
  it('starts empty', async () => { expect(await getPins()).toEqual([]) })
  it('adds and dedupes by url', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await addPin({ label: 'A2', url: 'https://x/1' })
    expect(after).toHaveLength(1)
  })
  it('removes by url', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    expect(await removePin('https://x/1')).toEqual([])
  })
  it('caps at 20', async () => {
    for (let i = 0; i < 25; i++) await addPin({ label: `p${i}`, url: `https://x/${i}` })
    expect((await getPins()).length).toBe(20)
  })
  it('trims and caps an over-long label on add', async () => {
    const long = '  ' + 'z'.repeat(MAX_PIN_LABEL + 40) + '  '
    const after = await addPin({ label: long, url: 'https://x/long' })
    expect(after[0].label).toBe('z'.repeat(MAX_PIN_LABEL))
  })
})

describe('renamePin', () => {
  it('renames the matching pin and leaves the others alone', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    await addPin({ label: 'B', url: 'https://x/2' })
    const after = await renamePin('https://x/1', 'Wiki bio')
    expect(after.find((p) => p.url === 'https://x/1')!.label).toBe('Wiki bio')
    expect(after.find((p) => p.url === 'https://x/2')!.label).toBe('B')
  })
  it('persists the rename', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    await renamePin('https://x/1', 'Short')
    expect((await getPins())[0].label).toBe('Short')
  })
  it('trims surrounding whitespace', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await renamePin('https://x/1', '   Padded   ')
    expect(after[0].label).toBe('Padded')
  })
  it('leaves the label alone when given a blank name', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await renamePin('https://x/1', '   ')
    expect(after[0].label).toBe('A')
  })
  it('caps an over-long new name', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await renamePin('https://x/1', 'y'.repeat(MAX_PIN_LABEL + 40))
    expect(after[0].label).toBe('y'.repeat(MAX_PIN_LABEL))
  })
  it('is a no-op for a url that is not pinned', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await renamePin('https://x/nope', 'New')
    expect(after).toEqual([{ label: 'A', url: 'https://x/1' }])
  })
  it('keeps the url unchanged', async () => {
    await addPin({ label: 'A', url: 'https://x/1' })
    const after = await renamePin('https://x/1', 'Renamed')
    expect(after[0].url).toBe('https://x/1')
  })
})

describe('normalizePinUrl', () => {
  it('assumes https for a bare host', () => {
    expect(normalizePinUrl('wiki.starbase118.net/wiki/Foo')).toBe(
      'https://wiki.starbase118.net/wiki/Foo'
    )
  })
  it('keeps an explicit scheme', () => {
    expect(normalizePinUrl('http://example.test/a')).toBe('http://example.test/a')
    expect(normalizePinUrl('https://example.test/a')).toBe('https://example.test/a')
  })
  it('trims surrounding whitespace', () => {
    expect(normalizePinUrl('  example.test  ')).toBe('https://example.test/')
  })
  // The host here ends in a colon-and-digits, which a looser scheme test reads
  // as a scheme and rejects.
  it('accepts a bare host with a port', () => {
    expect(normalizePinUrl('example.test:8080/x')).toBe('https://example.test:8080/x')
  })
  // A pin chip is opened with browser.tabs.create(), so anything that isn't
  // http(s) must be rejected before it can be stored, not after.
  it('rejects a scheme the popup must never open', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'chrome://settings',
    ]) {
      expect(normalizePinUrl(bad)).toBeNull()
    }
  })
  it('rejects empty or unparseable input', () => {
    for (const bad of ['', '   ', 'https://']) expect(normalizePinUrl(bad)).toBeNull()
  })
})

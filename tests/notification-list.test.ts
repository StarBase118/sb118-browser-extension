import { describe, it, expect } from 'vitest'
import { buildNotificationList } from '@/lib/notification-list'
import { ALL_SOURCES, type NotificationSource } from '@/lib/notifications-types'

const item = (id: string, at: string, title = id) => ({ id, title, url: `https://x/${id}`, at })
const ALL = ALL_SOURCES

describe('buildNotificationList', () => {
  it('merges sources newest first', () => {
    const r = buildNotificationList(
      {
        news: { items: [item('n1', '2026-08-13T09:00:00Z')] },
        sims: { items: [item('s1', '2026-08-13T11:00:00Z')] },
        announcements: { items: [item('a1', '2026-08-13T10:00:00Z')] },
      },
      {}, ALL
    )
    expect(r.items.map((i) => i.id)).toEqual(['s1', 'a1', 'n1'])
    expect(r.state).toBe('ok')
  })

  it('tags each item with its source', () => {
    const r = buildNotificationList({ sims: { items: [item('s1', '2026-08-13T11:00:00Z')] } }, {}, ALL)
    expect(r.items[0].source).toBe('sims')
  })

  it('flags new against the boundary the badge uses', () => {
    const r = buildNotificationList(
      { news: { items: [item('at', '2026-08-13T10:00:00Z'), item('after', '2026-08-13T10:00:00.001Z')] } },
      { news: '2026-08-13T10:00:00Z' }, ALL
    )
    expect(r.items.find((i) => i.id === 'at')!.isNew).toBe(false)
    expect(r.items.find((i) => i.id === 'after')!.isNew).toBe(true)
  })

  it('treats a missing marker as everything new', () => {
    const r = buildNotificationList({ news: { items: [item('n1', '2026-08-13T09:00:00Z')] } }, {}, ALL)
    expect(r.items[0].isNew).toBe(true)
  })

  it('treats an unparseable marker as everything new', () => {
    const r = buildNotificationList(
      { news: { items: [item('n1', '2026-08-13T09:00:00Z')] } },
      { news: 'garbage' }, ALL
    )
    expect(r.items[0].isNew).toBe(true)
  })

  it('skips an unavailable source instead of rendering it empty', () => {
    const r = buildNotificationList(
      { news: { items: [item('n1', '2026-08-13T09:00:00Z')] }, sims: { items: [], unavailable: true } },
      {}, ALL
    )
    expect(r.items.map((i) => i.id)).toEqual(['n1'])
    expect(r.state).toBe('ok')
  })

  it('excludes a source the member switched off', () => {
    const r = buildNotificationList(
      { news: { items: [item('n1', '2026-08-13T09:00:00Z')] }, sims: { items: [item('s1', '2026-08-13T11:00:00Z')] } },
      {}, ['news'] as NotificationSource[]
    )
    expect(r.items.map((i) => i.id)).toEqual(['n1'])
  })

  it('caps at 8 when everything is old', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      item(`n${i}`, new Date(Date.UTC(2026, 7, 13, 0, i)).toISOString()))
    const r = buildNotificationList({ news: { items } }, { news: '2026-08-14T00:00:00Z' }, ALL)
    expect(r.items).toHaveLength(8)
    expect(r.items.every((i) => !i.isNew)).toBe(true)
  })

  it('exceeds the cap rather than dropping a new item', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item(`n${i}`, new Date(Date.UTC(2026, 7, 13, 0, i)).toISOString()))
    const r = buildNotificationList({ news: { items } }, {}, ALL)
    expect(r.items).toHaveLength(12)
  })

  // The bug a sort-then-slice would ship. Markers are PER SOURCE, so a read sim
  // from five hours ago is chronologically above an unread news item from two
  // days ago; slicing a time-sorted list at the cap drops the unread one.
  it('keeps an unread item that is older than the read items filling the cap', () => {
    const sims = Array.from({ length: 10 }, (_, i) =>
      item(`s${i}`, new Date(Date.UTC(2026, 7, 13, 5, i)).toISOString()))
    const r = buildNotificationList(
      {
        sims: { items: sims },
        news: { items: [item('unread-news', '2026-08-11T00:00:00Z')] },
      },
      { sims: '2026-08-13T23:00:00Z', news: '2026-08-10T00:00:00Z' },
      ALL
    )
    expect(r.items.map((i) => i.id)).toContain('unread-news')
    expect(r.items[0].id).toBe('unread-news')
    expect(r.items[0].isNew).toBe(true)
  })

  it('sorts an unparseable timestamp last without dropping it', () => {
    const r = buildNotificationList(
      { news: { items: [item('bad', 'garbage'), item('good', '2026-08-13T09:00:00Z')] } },
      { news: '2026-08-14T00:00:00Z' }, ALL
    )
    expect(r.items.map((i) => i.id)).toEqual(['good', 'bad'])
  })

  it('reports an outage only when every enabled source failed and nothing survived', () => {
    const r = buildNotificationList(
      { news: { items: [], unavailable: true }, sims: { items: [], unavailable: true },
        announcements: { items: [], unavailable: true } },
      {}, ALL
    )
    expect(r.state).toBe('outage')
  })

  it('is ok, not an outage, when sources are healthy but quiet', () => {
    const r = buildNotificationList({ news: { items: [] } }, {}, ALL)
    expect(r.state).toBe('ok')
    expect(r.items).toEqual([])
  })

  // An entirely empty payload is every source ABSENT, not every source flagged
  // unavailable. Conflating the two reported an outage for a healthy quiet
  // cache — the end-to-end run caught it because the case above was written
  // with a present-but-empty group, which takes a different branch.
  it('is ok, not an outage, for a payload with no sources at all', () => {
    const r = buildNotificationList({}, {}, ALL)
    expect(r.state).toBe('ok')
    expect(r.items).toEqual([])
  })

  it('still renders items when only some sources are unavailable', () => {
    const r = buildNotificationList(
      {
        news: { items: [item('n1', '2026-08-13T09:00:00Z')] },
        sims: { items: [], unavailable: true },
      },
      {}, ALL
    )
    expect(r.state).toBe('ok')
    expect(r.items.map((i) => i.id)).toEqual(['n1'])
  })

  // The disabled check must come first, or someone who switched everything off
  // is told HQ is broken.
  it('is disabled, not an outage, when no sources are enabled', () => {
    const r = buildNotificationList(
      { news: { items: [], unavailable: true } }, {}, []
    )
    expect(r.state).toBe('disabled')
  })
})

describe('clicked items', () => {
  const at = (d: string) => `2026-08-${d}T00:00:00.000Z`
  const marker = { news: at('01') } // everything below is newer, so all are "fresh"

  it('leaves the result unchanged when nothing is clicked', () => {
    const sources = {
      news: { items: [{ id: '1', title: 'one', url: 'u1', at: at('10') }] },
    }
    const { items } = buildNotificationList(sources, marker, ['news'])
    expect(items.map((i) => i.id)).toEqual(['1'])
  })

  it('drops a clicked item', () => {
    const sources = {
      news: {
        items: [
          { id: '1', title: 'one', url: 'u1', at: at('10') },
          { id: '2', title: 'two', url: 'u2', at: at('09') },
        ],
      },
    }
    const { items } = buildNotificationList(sources, marker, ['news'], new Set(['news:1']))
    expect(items.map((i) => i.id)).toEqual(['2'])
  })

  // source:id isolation. Clicking announcements:1 must not hide news:1.
  it('does not hide a same-id item in another source', () => {
    const sources = {
      announcements: { items: [{ id: '1', title: 'ann', url: 'ua', at: at('10') }] },
      news: { items: [{ id: '1', title: 'news', url: 'un', at: at('09') }] },
    }
    const { items } = buildNotificationList(
      sources,
      { announcements: at('01'), news: at('01') },
      ['announcements', 'news'],
      new Set(['announcements:1'])
    )
    expect(items.map((i) => `${i.source}:${i.id}`)).toEqual(['news:1'])
  })

  /**
   * THE backfill case, and the reason the filter runs BEFORE the partition.
   *
   * FIXTURE SIZE IS LOAD-BEARING: three seen items against a cap of two is the
   * minimum that can tell filter-before-partition from filter-after. With two
   * items there is no third to backfill from and the mutated code passes.
   * Do not shrink this fixture — re-run the mutation if you are tempted.
   */
  it('backfills when a clicked item is removed from the seen half', () => {
    const seenMarker = { news: at('20') } // every item below is older => "seen"
    const sources = {
      news: {
        items: [
          { id: '1', title: 'one', url: 'u1', at: at('12') },
          { id: '2', title: 'two', url: 'u2', at: at('11') },
          { id: '3', title: 'three', url: 'u3', at: at('10') },
        ],
      },
    }
    const { items } = buildNotificationList(
      sources,
      seenMarker,
      ['news'],
      new Set(['news:1']),
      2
    )
    expect(items.map((i) => i.id)).toEqual(['2', '3'])
  })

  it('drops a clicked item that is still new', () => {
    const sources = {
      news: {
        items: [
          { id: '1', title: 'one', url: 'u1', at: at('10') },
          { id: '2', title: 'two', url: 'u2', at: at('09') },
        ],
      },
    }
    const { items } = buildNotificationList(sources, marker, ['news'], new Set(['news:1']))
    expect(items.every((i) => i.id !== '1')).toBe(true)
    expect(items.map((i) => i.isNew)).toEqual([true])
  })
})

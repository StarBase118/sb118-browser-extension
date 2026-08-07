import { describe, it, expect } from 'vitest'
import { MEMBER_LINKS, STAFF_LINKS, visibleLinks } from '@/lib/launcher'

describe('launcher config', () => {
  it('member links never include Forums or NocoDB', () => {
    const labels = MEMBER_LINKS.map((l) => l.label.toLowerCase())
    expect(labels).not.toContain('forums')
    expect(labels.join(' ')).not.toContain('nocodb')
  })
  it('no staff link is NocoDB', () => {
    expect(STAFF_LINKS.map((l) => l.label.toLowerCase())).not.toContain('nocodb')
  })
  it('visibleLinks(false) returns only member links', () => {
    expect(visibleLinks(false)).toEqual(MEMBER_LINKS)
  })
  it('visibleLinks(true) returns member + staff links', () => {
    expect(visibleLinks(true)).toEqual([...MEMBER_LINKS, ...STAFF_LINKS])
  })
})

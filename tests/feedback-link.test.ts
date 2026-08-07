import { describe, it, expect } from 'vitest'
import { buildFeedbackUrl } from '@/lib/feedback-link'

describe('buildFeedbackUrl', () => {
  it('carries the page URL and title', () => {
    const u = buildFeedbackUrl(
      'https://wiki.starbase118.net/wiki/Example',
      'Example — 118Wiki'
    )
    expect(u).toBe(
      'https://hq.starbase118.net/feedback/new' +
        '?url=https%3A%2F%2Fwiki.starbase118.net%2Fwiki%2FExample' +
        '&title=Example%20%E2%80%94%20118Wiki'
    )
  })

  it('tolerates a missing title', () => {
    expect(buildFeedbackUrl('https://starbase118.net/', undefined)).toBe(
      'https://hq.starbase118.net/feedback/new?url=https%3A%2F%2Fstarbase118.net%2F&title='
    )
  })

  it('encodes a URL containing a query string and fragment', () => {
    const u = buildFeedbackUrl('https://wiki.starbase118.net/w/index.php?a=1#x', 'T')
    expect(u).toContain('%3Fa%3D1%23x')
  })

  // A tab with no URL (a chrome:// page, or host permissions withheld) still
  // has to produce a usable report form — it just cannot say which page it is
  // about. Returning something unopenable here would make the popup action
  // silently do nothing on exactly the tabs a member is most likely to be
  // confused by.
  it('still returns the report page when there is no tab URL', () => {
    expect(buildFeedbackUrl('', '')).toBe(
      'https://hq.starbase118.net/feedback/new?url=&title='
    )
  })
})

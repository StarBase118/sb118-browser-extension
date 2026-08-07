const HQ = 'https://hq.starbase118.net'

/**
 * The HQ report page for a given tab, carrying its URL and title.
 *
 * The extension opens this in a new tab rather than injecting HQ's in-page
 * panel, which is what the wiki, main site and staff forum triggers do.
 * Injecting would need a `scripting` permission plus a host permission for
 * every site it could reach — both widen what the extension is allowed to do,
 * and both get re-reviewed at store submission. The popup is also already a
 * surface the member deliberately opened, so leaving the page is not the
 * intrusion it would be for an in-page trigger.
 *
 * The in-place version stays available later: add `"scripting"` and the missing
 * host permission, then reuse the loader the other three triggers share. Do
 * that if members ask for it, not pre-emptively.
 */
export function buildFeedbackUrl(pageUrl: string, pageTitle?: string): string {
  const url = encodeURIComponent(pageUrl)
  const title = encodeURIComponent(pageTitle ?? '')
  return `${HQ}/feedback/new?url=${url}&title=${title}`
}

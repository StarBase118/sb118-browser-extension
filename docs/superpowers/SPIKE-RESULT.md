# Session-access spike result

**Date:** 2026-07-24
**MECHANISM: direct**

## What was tested

A throwaway MV3 extension (host permission `https://hq.starbase118.net/*`) made a
credentialed cross-site fetch to the existing authenticated route `/api/v1/me`:

```js
fetch('https://hq.starbase118.net/api/v1/me', { credentials: 'include' })
```

## Result (Chrome)

- `origin: chrome-extension://…`
- `status: 200`, `redirected: false`
- Body was the signed-in member's real profile JSON (name, email, groups).

**Conclusion:** Chrome extensions with `host_permissions` DO send the NextAuth
`SameSite=Lax` session cookie on credentialed cross-site fetches. The naive
SameSite concern does not apply to the extension-host-permission case in Chrome.
→ Slice 5 uses the **direct-fetch** `getProfile()` client. No content-script relay.

## Caveat — Firefox

Only Chrome was tested here. Firefox is generally stricter about cross-site
cookies. **Verify at Slice 7's Firefox smoke test** that the direct fetch also
returns 200 in Firefox. If Firefox does NOT carry the cookie, add the
content-script relay (fully specified in the Phase 1 plan's Slice 5) as a
Firefox-only fallback; Chrome stays on direct.

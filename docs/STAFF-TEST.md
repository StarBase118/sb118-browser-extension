# Staff test round

Thanks for trying this. It is a real working extension, not a mockup, but it has not been
through the browser stores yet, so installing it takes about two minutes and a couple of
clicks you would not normally make.

**What we most want to know:** does the notification badge show you numbers that feel right,
and does anything look broken or confusing? Rough impressions are useful. You do not need to
write a bug report to be helpful.

## Install

Download the build for your browser from
[Releases](https://github.com/StarBase118/sb118-browser-extension/releases/latest).

### Chrome, Edge or Brave

1. Download the `sb118-extension-chromium-*.zip` and unzip it.
2. Put the unzipped folder somewhere you will not delete by accident — deleting it uninstalls
   the extension.
3. Go to `chrome://extensions` (or `edge://extensions`).
4. Turn on **Developer mode**, top right.
5. Click **Load unpacked** and choose the unzipped folder.

Chrome will show a "you have developer extensions running" warning on startup. That is
expected for anything not installed from the store, and it goes away when we publish.

### Firefox

1. Download the `sb118-extension-firefox-*.zip` and unzip it.
2. Go to `about:debugging` → **This Firefox**.
3. Click **Load Temporary Add-on** and choose the `manifest.json` inside the unzipped folder.

**Firefox forgets temporary add-ons when you restart it.** You will need to load it again each
session. That is a Firefox rule about unsigned add-ons, not a bug in the extension, and it
also disappears when we publish.

## Then

Sign in to [HQ](https://hq.starbase118.net) as usual in a normal tab. The extension reads that
session — it never asks for your password. The light in the popup turns green once it has one.

Pin the extension to your toolbar so you can see the badge: click the puzzle-piece icon in
Chrome, then the pin next to StarBase 118.

## What to look at

1. **The badge number.** Within 15 minutes it should show a count of new announcements, new
   sims on your ship, and new Community News. Does the number look plausible? Opening the
   popup clears it.
2. **The sim count specifically.** It should reflect your actual ship. If you are on a ship
   and it stays at zero for a day, tell us — that is the exact bug we fixed last, and we want
   to know if it survived.
3. **The options page** (right-click the icon → Options). Switch a source off. Its
   contribution to the badge should stop. Switch it back on and what accumulated should
   reappear rather than being silently swallowed.
4. **Search.** Type in the box. Results come from HQ pages, the wiki, the main site and the
   staff forum, and each group appears as that source answers.
5. **Your ship and character chips.** Do they go to the right wiki pages?

## Known gaps — not bugs, please don't report these

- **The popup does not list the notifications themselves.** The badge tells you how many
  things are new; it does not yet show you what they are. Clicking through to HQ, Discord or
  the news page is still manual. This is the next thing we build, and it is the feedback we
  expect most, so consider it already heard.
- **The badge does not sync between computers.** It is counted per browser, on purpose —
  nothing about what you have read leaves your machine.
- **Firefox forgets the add-on on restart.** See above.
- **"My ship" links to HQ, not a ship wiki page.** We do not have a reliable source for ship
  wiki URLs yet.
- **Chrome's "developer extensions" warning.** Expected until we publish.

## Telling us what you found

Open an issue: https://github.com/StarBase118/sb118-browser-extension/issues — there are
templates for bugs and ideas. Say which browser you are on. A screenshot of the popup helps
more than a description of it.

For anything security-related, follow [SECURITY.md](../SECURITY.md) instead. Please do not put
it in a public issue.

## Uninstalling

- **Chrome / Edge / Brave** — `chrome://extensions`, then **Remove**.
- **Firefox** — restart it, or `about:debugging` → **Remove**.

Neither leaves anything behind beyond the folder you unzipped, which you can delete.

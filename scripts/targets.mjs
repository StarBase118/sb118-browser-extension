/**
 * The build targets, in their own module so `build.mjs` and `package.mjs` can
 * share one list.
 *
 * Deliberately NOT exported from `build.mjs`: that file runs the whole Vite
 * build at the top level, so importing a constant from it would kick off a
 * build as a side effect of the import.
 */
export const targets = [
  { name: 'chromium', manifest: 'src/manifest.chromium.json' },
  { name: 'firefox', manifest: 'src/manifest.firefox.json' },
]

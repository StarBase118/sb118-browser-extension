// Phase 1 background worker: no active behavior yet (badge polling lands in Phase 3).
// Present so the manifest's background entry resolves and the worker registers.
import browser from 'webextension-polyfill'
browser.runtime.onInstalled.addListener(() => {
  console.debug('[sb118] extension installed')
})

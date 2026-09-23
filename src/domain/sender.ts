/**
 * Sender checks for extension-internal messages. `chrome.runtime.sendMessage`
 * broadcasts to every extension context (popup, offscreen document, content scripts'
 * extension side...), so a listener must confirm *who* sent a message before acting on
 * it; a message merely having the right shape proves nothing about its origin.
 */

/** True only for messages sent from this extension's own page at `pagePath` (e.g. the offscreen document). */
export const isFromExtensionPage = (sender: chrome.runtime.MessageSender, pagePath: string): boolean =>
  sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL(pagePath);

/**
 * True only for messages sent from this extension's background service worker.
 *
 * Identified as "an extension *script* context": same extension id, no tab, and a
 * script URL rather than one of our .html pages (popup, offscreen document). It can't
 * compare against the manifest's service_worker path because offscreen documents —
 * the caller that needs this — only get a small subset of `chrome.runtime` (verified
 * in Chrome: `id`, `getURL`, `sendMessage`, `onMessage`, ...; no `getManifest`).
 */
export const isFromServiceWorker = (sender: chrome.runtime.MessageSender): boolean =>
  sender.id === chrome.runtime.id &&
  sender.tab === undefined &&
  sender.url !== undefined &&
  new URL(sender.url).pathname.endsWith(".js");

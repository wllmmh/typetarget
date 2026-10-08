/**
 * The set of tabs TypeTarget may capture: those it has been invoked on (popup or
 * right-click menu).
 *
 * Two Chrome constraints force this. Without the `tabs` permission,
 * `chrome.tabs.query` returns only `{id, audible}` — no titles to show. And
 * `tabCapture.getMediaStreamId` accepts a target tab only if `activeTab` was granted
 * for it, which happens when the user invokes the extension on that tab. So that moment
 * is exactly when a tab becomes both labellable and capturable
 * (docs/adr/0008-source-tab-is-the-tab-typetarget-was-invoked-on.md).
 *
 * Pure functions over a list; the service worker owns the chrome.tabs wiring.
 */
import type { CapturableTab } from "../domain/messages";

/** Enough for the handful of tabs a person switches between, without unbounded growth. */
const MAX_KNOWN_TABS = 10;

/** Only web pages: tab audio from an extension page isn't a thing anyone wants to transcribe. */
const isCapturableUrl = (url: string): boolean => url.startsWith("http://") || url.startsWith("https://");

/**
 * Records a tab as capturable, most-recent-first. Returns the list unchanged when the
 * tab can't be captured or labelled (no id, or no url/title because `activeTab` wasn't
 * granted for it).
 */
export const recordKnownTab = (known: readonly CapturableTab[], tab: chrome.tabs.Tab): CapturableTab[] => {
  const { id, url, title } = tab;
  if (typeof id !== "number" || !url || !isCapturableUrl(url)) return [...known];

  const entry: CapturableTab = { tabId: id, title: title?.trim() || url, url, favIconUrl: tab.favIconUrl };
  return [entry, ...known.filter((t) => t.tabId !== id)].slice(0, MAX_KNOWN_TABS);
};

/**
 * Applies a `chrome.tabs.onUpdated` change to a known tab, so its label follows the page
 * (a YouTube tab's title changes with each video). Chrome includes `title`/`url` in the
 * change only while TypeTarget can read the tab (activeTab not yet revoked), so an absent
 * field keeps the last known value. Returns `known` itself when nothing changed, so
 * callers can skip a broadcast by identity.
 */
export const updateKnownTab = (
  known: CapturableTab[],
  tabId: number,
  change: Pick<chrome.tabs.TabChangeInfo, "title" | "url" | "favIconUrl">,
): CapturableTab[] => {
  const current = known.find((t) => t.tabId === tabId);
  if (!current) return known;
  const url = change.url && isCapturableUrl(change.url) ? change.url : current.url;
  const title = change.title === undefined ? current.title : change.title.trim() || url;
  const favIconUrl = change.favIconUrl ?? current.favIconUrl;
  if (title === current.title && url === current.url && favIconUrl === current.favIconUrl) return known;
  return known.map((t) => (t.tabId === tabId ? { ...t, title, url, favIconUrl } : t));
};

/** Whether two lists would render identically (order, ids, and labels). */
export const sameKnownTabs = (a: readonly CapturableTab[], b: readonly CapturableTab[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const removeKnownTab = (known: readonly CapturableTab[], tabId: number): CapturableTab[] =>
  known.filter((t) => t.tabId !== tabId);

/** Drops tabs that no longer exist, so a closed tab can't be shown as the source. */
export const pruneKnownTabs = (known: readonly CapturableTab[], openTabIds: readonly number[]): CapturableTab[] => {
  const open = new Set(openTabIds);
  return known.filter((t) => open.has(t.tabId));
};

/** Storage may hold values written by an older build, so treat it as untrusted input. */
export const parseKnownTabs = (value: unknown): CapturableTab[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CapturableTab[] => {
    if (typeof item !== "object" || item === null) return [];
    const { tabId, title, url, favIconUrl } = item as Record<string, unknown>;
    if (typeof tabId !== "number" || typeof title !== "string" || typeof url !== "string") return [];
    return [{ tabId, title, url, ...(typeof favIconUrl === "string" ? { favIconUrl } : {}) }];
  });
};

/**
 * The set of tabs TypeTarget may capture: those the popup has been opened on.
 *
 * Two Chrome constraints force this. Without the `tabs` permission,
 * `chrome.tabs.query` returns only `{id, audible}` — no titles to show. And
 * `tabCapture.getMediaStreamId` accepts a target tab only if `activeTab` was granted
 * for it, which happens when the user invokes the extension on that tab. So opening the
 * popup on a tab is exactly what makes it both labellable and capturable, and recording
 * that moment gives an honest list instead of a wall of "Untitled tab".
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

export const removeKnownTab = (known: readonly CapturableTab[], tabId: number): CapturableTab[] =>
  known.filter((t) => t.tabId !== tabId);

/** Drops tabs that no longer exist, so the dropdown can't offer a closed tab. */
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

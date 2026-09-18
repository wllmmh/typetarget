/**
 * Owns destination selection/binding from the service worker's side. Per AGENTS.md
 * "Content script permissions": destination pages are arbitrary and unknown ahead of
 * time, so rather than a persistent <all_urls> content_scripts entry, the content
 * script is injected on demand via chrome.scripting, scoped to activeTab (the tab the
 * user is looking at when they click "Select destination").
 */
import { envelope, type BackgroundToContent, type DestinationRef } from "../domain/messages";
// `?script&iife` is @crxjs/vite-plugin's mechanism for content scripts that are only
// ever injected dynamically (via chrome.scripting.executeScript) rather than declared
// in manifest.content_scripts, which is the only place crxjs's own build-file
// discovery looks. The import resolves, at both dev and build time, to the real
// on-disk path of the built file (hashed in production), built as a standalone IIFE
// so it runs correctly as a classic injected script instead of an ES module needing
// a loader. See @crxjs/vite-plugin's dynamic-content-scripts plugin.
import contentScriptFile from "../content/main.ts?script&iife";

export class DestinationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const injectContentScript = async (tabId: number): Promise<void> => {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [contentScriptFile],
  });
};

const sendToContentScript = async (
  tabId: number,
  msg: BackgroundToContent,
): Promise<void> => {
  await chrome.tabs.sendMessage(tabId, envelope(msg));
};

export type DestinationCallbacks = {
  onPicked: (ref: DestinationRef, label: string) => void;
  onUnavailable: (reason: string) => void;
};

export class DestinationController {
  private selectingTabId: number | null = null;

  constructor(private readonly callbacks: DestinationCallbacks) {}

  get isSelecting(): boolean {
    return this.selectingTabId !== null;
  }

  /** Injects the content script into the active tab and puts it into selection mode. */
  async beginSelection(): Promise<void> {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      throw new DestinationError("No active tab to select a destination in.", "no-active-tab");
    }

    await injectContentScript(activeTab.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown injection error.";
      throw new DestinationError(`Could not prepare this page for destination selection. (${message})`, "injection-failed");
    });

    this.selectingTabId = activeTab.id;
    await sendToContentScript(activeTab.id, { kind: "enter-selection-mode" });
  }

  async cancelSelection(): Promise<void> {
    if (this.selectingTabId === null) return;
    await sendToContentScript(this.selectingTabId, { kind: "exit-selection-mode" }).catch(() => {});
    this.selectingTabId = null;
  }

  /** Called by the message router when the content script reports a pick. */
  handlePicked(tabId: number, frameId: number, elementId: string, label: string): void {
    if (tabId !== this.selectingTabId) return; // stale pick from a tab we're no longer selecting in
    this.selectingTabId = null;
    this.callbacks.onPicked({ tabId, frameId, elementId }, label);
  }

  async checkAlive(destination: DestinationRef): Promise<void> {
    await sendToContentScript(destination.tabId, { kind: "check-destination-alive" }).catch(() => {
      this.callbacks.onUnavailable("Destination tab is no longer available.");
    });
  }

  async insertText(destination: DestinationRef, text: string, separator: string): Promise<void> {
    await sendToContentScript(destination.tabId, { kind: "insert-text", text, separator }).catch(() => {
      this.callbacks.onUnavailable("Destination tab is no longer available.");
    });
  }
}

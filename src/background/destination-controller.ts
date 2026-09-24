/**
 * Owns destination selection/binding from the service worker's side. Per AGENTS.md
 * "Content script permissions": destination pages are arbitrary and unknown ahead of
 * time, so rather than a persistent <all_urls> content_scripts entry, the content
 * script is injected on demand via chrome.scripting, scoped to activeTab (the tab the
 * user is looking at when they click "Select destination").
 */
import { envelope, isEnvelope, type BackgroundToContent, type BackgroundResponse, type DestinationRef } from "../domain/messages";
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

/**
 * Addressed to the one frame that owns the destination element. A tab-wide send reaches
 * every frame the script was injected into (injection is allFrames, since the user may
 * pick inside an iframe), and every other frame would answer "destination-unavailable"
 * — which the background treats as the destination going away, unbinding it.
 */
const sendToDestinationFrame = async (
  destination: DestinationRef,
  msg: BackgroundToContent,
): Promise<void> => {
  await chrome.tabs.sendMessage(destination.tabId, envelope(msg), { frameId: destination.frameId });
};

export type DestinationCallbacks = {
  onPicked: (ref: DestinationRef, label: string) => void;
  onUnavailable: (reason: string) => void;
};

export class DestinationController {
  /**
   * Tabs currently in selection mode. Usually one — the tab "Select output" was clicked in —
   * plus any the user switches to while picking that TypeTarget can reach (see followTo).
   */
  private selectingTabIds = new Set<number>();

  constructor(private readonly callbacks: DestinationCallbacks) {}

  get isSelecting(): boolean {
    return this.selectingTabIds.size > 0;
  }

  /** Injects the content script into the active tab and puts it into selection mode. */
  async beginSelection(): Promise<void> {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      throw new DestinationError("No active tab to select a destination in.", "no-active-tab");
    }
    await this.enterSelection(activeTab.id);
  }

  /**
   * While picking, the user switched to `tabId`: extends selection mode there so a click in
   * that tab picks too. Chrome only lets the script in if TypeTarget can reach the tab — it
   * was opened on (activeTab, until that tab navigates) or was already in selection mode —
   * so the injection attempt is the access check. Returns false if it can't reach the tab.
   */
  async followTo(tabId: number): Promise<boolean> {
    if (!this.isSelecting || this.selectingTabIds.has(tabId)) return true;
    try {
      await this.enterSelection(tabId);
      return true;
    } catch {
      return false;
    }
  }

  private async enterSelection(tabId: number): Promise<void> {
    await injectContentScript(tabId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown injection error.";
      throw new DestinationError(`Could not prepare this page for destination selection. (${message})`, "injection-failed");
    });
    this.selectingTabIds.add(tabId);
    await sendToContentScript(tabId, { kind: "enter-selection-mode" });
  }

  /**
   * Picks the text box the user right-clicked, via the right-click menu's TypeTarget → "Select output".
   * Choosing a menu item grants activeTab for its tab — the same grant opening the popup
   * gives — so this works in any tab or window, not just the one "Select output" was
   * clicked in. Injected into only the clicked frame; the pick then arrives through
   * handlePicked like any other.
   */
  async pickFromContextMenu(tabId: number, frameId: number): Promise<void> {
    await this.cancelSelection();
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: [contentScriptFile] }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown injection error.";
      throw new DestinationError(`Could not prepare this page to receive text. (${message})`, "injection-failed");
    });
    this.selectingTabIds.add(tabId);
    const raw: unknown = await chrome.tabs.sendMessage(tabId, envelope<BackgroundToContent>({ kind: "pick-focused-element" }), { frameId });
    if (isEnvelope<BackgroundResponse>(raw) && raw.payload.kind === "error") {
      this.selectingTabIds.delete(tabId);
      throw new DestinationError(raw.payload.message, raw.payload.code);
    }
  }

  async cancelSelection(): Promise<void> {
    const tabIds = [...this.selectingTabIds];
    this.selectingTabIds.clear();
    await Promise.all(tabIds.map((tabId) => sendToContentScript(tabId, { kind: "exit-selection-mode" }).catch(() => {})));
  }

  /** Called by the message router when the content script reports a pick. */
  handlePicked(tabId: number, frameId: number, elementId: string, label: string): void {
    if (!this.selectingTabIds.has(tabId)) return; // stale pick from a tab we're no longer selecting in
    // The picking tab already left selection mode itself; any others it was extended to must too.
    this.selectingTabIds.delete(tabId);
    void this.cancelSelection();
    this.callbacks.onPicked({ tabId, frameId, elementId }, label);
  }

  async checkAlive(destination: DestinationRef): Promise<void> {
    await sendToDestinationFrame(destination, { kind: "check-destination-alive" }).catch(() => {
      this.callbacks.onUnavailable("Destination tab is no longer available.");
    });
  }

  /** Tells the page to drop a destination the user deselected or replaced (removing its
   * outline). Best effort: if the tab or frame is gone, so is the outline. */
  async release(destination: DestinationRef): Promise<void> {
    await sendToDestinationFrame(destination, { kind: "clear-destination" }).catch(() => {});
  }

  async insertText(destination: DestinationRef, text: string, separator: string): Promise<void> {
    await sendToDestinationFrame(destination, { kind: "insert-text", text, separator }).catch(() => {
      this.callbacks.onUnavailable("Destination tab is no longer available.");
    });
  }
}

/**
 * Owns the capture lifecycle from the service worker's side: starting/stopping tab
 * capture (via the offscreen document), and detecting source-tab closure/navigation
 * so capture doesn't silently keep running against a tab that's gone away (see
 * AGENTS.md "Resource cleanup", "Error handling").
 */
import { envelope, isEnvelope, type BackgroundToOffscreen, type OffscreenReply } from "../domain/messages";
import { getTabCaptureStreamId } from "./tab-capture";
import { ensureOffscreenDocument, closeOffscreenDocument } from "./offscreen-manager";

const sendToOffscreen = async (msg: BackgroundToOffscreen): Promise<OffscreenReply> => {
  const raw = await chrome.runtime.sendMessage(envelope(msg));
  if (!isEnvelope<OffscreenReply>(raw)) {
    return { kind: "error", code: "bad-offscreen-response", message: "Offscreen document returned no reply." };
  }
  return raw.payload;
};

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export type CaptureLifecycleCallbacks = {
  onSourceTabClosed: () => void;
};

export class CaptureController {
  private sourceTabId: number | null = null;
  private readonly onTabRemoved = (tabId: number) => {
    if (tabId === this.sourceTabId) {
      this.sourceTabId = null;
      this.callbacks.onSourceTabClosed();
    }
  };

  constructor(private readonly callbacks: CaptureLifecycleCallbacks) {}

  get currentSourceTabId(): number | null {
    return this.sourceTabId;
  }

  async start(sourceTabId: number): Promise<void> {
    const tab = await chrome.tabs.get(sourceTabId).catch(() => null);
    if (!tab) {
      throw new CaptureError("Source tab is no longer available.", "source-tab-missing");
    }

    const streamId = await getTabCaptureStreamId(sourceTabId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown tab capture error.";
      throw new CaptureError(`Chrome did not provide an audio track for this tab. (${message})`, "capture-failed");
    });

    await ensureOffscreenDocument();
    const reply = await sendToOffscreen({ kind: "start-capture", streamId });
    if (reply.kind === "error") {
      throw new CaptureError(reply.message, reply.code);
    }

    this.sourceTabId = sourceTabId;
    if (!chrome.tabs.onRemoved.hasListener(this.onTabRemoved)) {
      chrome.tabs.onRemoved.addListener(this.onTabRemoved);
    }
  }

  async stop(): Promise<void> {
    chrome.tabs.onRemoved.removeListener(this.onTabRemoved);
    this.sourceTabId = null;
    await sendToOffscreen({ kind: "stop-capture" }).catch(() => {
      // Offscreen document may already be gone (e.g. closed independently); stopping
      // is still a success from the caller's perspective since nothing is capturing.
    });
    await closeOffscreenDocument();
  }
}

/**
 * Owns the capture lifecycle from the service worker's side: starting/stopping tab
 * capture (via the offscreen document), and detecting source-tab closure so capture
 * doesn't silently keep running against a tab that's gone away.
 */
import { envelope, isEnvelope, type BackgroundToOffscreen, type OffscreenReply } from "../domain/messages";
import type { ModelId } from "../domain/models";
import type { ApiKeyProvider } from "../domain/api-key";
import { getTabCaptureStreamId } from "./tab-capture";
import { ensureOffscreenDocument, closeOffscreenDocument, hasOffscreenDocument } from "./offscreen-manager";

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

  /**
   * Starts capturing `sourceTabId`, then loads `modelId` in the background.
   *
   * Order matters: `tabCapture.getMediaStreamId` is tied to the user gesture that opened
   * the popup, so it must be called right away; a cold model download (~40-80 s) would
   * outlast the gesture. The model load is deliberately not awaited — capture is live
   * immediately, the offscreen document drops audio until the engine is ready, and load
   * progress/failures reach the popup through engine-status broadcasts.
   *
   * `apiKeys` are sent before the model load, not after: a network engine reads its key
   * when it loads, and a fresh offscreen document has none of the keys saved while idle.
   */
  async start(sourceTabId: number, modelId: ModelId, apiKeys: Partial<Record<ApiKeyProvider, string>> = {}): Promise<void> {
    const tab = await chrome.tabs.get(sourceTabId).catch(() => null);
    if (!tab) {
      throw new CaptureError("Source tab is no longer available.", "source-tab-missing");
    }

    try {
      await ensureOffscreenDocument();

      const streamId = await getTabCaptureStreamId(sourceTabId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown tab capture error.";
        throw new CaptureError(message, "capture-failed");
      });

      const started = await sendToOffscreen({ kind: "start-capture", streamId });
      if (started.kind === "error") {
        throw new CaptureError(started.message, started.code);
      }

      for (const [provider, apiKey] of Object.entries(apiKeys) as [ApiKeyProvider, string][]) {
        await sendToOffscreen({ kind: "set-api-key", provider, apiKey });
      }

      void sendToOffscreen({ kind: "load-model", modelId }).catch(() => {
        // Reported through engine-status instead; a rejection here only means the
        // offscreen document went away, which stop() already handles.
      });
    } catch (err) {
      // Don't leave a half-started capture (or a loaded model) in an orphaned document.
      await closeOffscreenDocument();
      throw err;
    }

    this.watchSourceTab(sourceTabId);
  }

  /**
   * After a service-worker restart: picks the running capture back up, if the offscreen
   * document (which Chrome keeps alive independently of this worker) is still capturing.
   * Returns its pause state, or null when nothing is capturing any more — then there is
   * nothing to resume, and any stream left for a source tab that is gone is stopped.
   */
  async reattach(sourceTabId: number): Promise<{ paused: boolean } | null> {
    if (!(await hasOffscreenDocument().catch(() => false))) return null;
    const reply = await sendToOffscreen({ kind: "get-capture-status" }).catch(() => null);
    if (reply?.kind !== "capture-status" || !reply.capturing) return null;
    if (!(await chrome.tabs.get(sourceTabId).catch(() => null))) {
      await this.stop();
      return null;
    }
    this.watchSourceTab(sourceTabId);
    return { paused: reply.paused };
  }

  private watchSourceTab(sourceTabId: number): void {
    this.sourceTabId = sourceTabId;
    if (!chrome.tabs.onRemoved.hasListener(this.onTabRemoved)) {
      chrome.tabs.onRemoved.addListener(this.onTabRemoved);
    }
  }

  /** Retunes the running pipeline. Safe to call when nothing is capturing; the message just goes nowhere. */
  async setChunkMs(chunkMs: number): Promise<void> {
    const reply = await sendToOffscreen({ kind: "set-chunk-ms", chunkMs });
    if (reply.kind === "error") {
      throw new CaptureError(reply.message, reply.code);
    }
  }

  /** Forwards a key entered mid-session to the running worker, so it takes effect
   * without restarting capture. Safe to call when nothing is capturing. */
  async setApiKey(provider: ApiKeyProvider, apiKey: string): Promise<void> {
    const reply = await sendToOffscreen({ kind: "set-api-key", provider, apiKey });
    if (reply.kind === "error") {
      throw new CaptureError(reply.message, reply.code);
    }
  }

  /** Stops sending captured audio for transcription; the tab keeps playing. */
  async pause(): Promise<void> {
    await this.sendPauseState("pause");
  }

  async resume(): Promise<void> {
    await this.sendPauseState("resume");
  }

  private async sendPauseState(kind: "pause" | "resume"): Promise<void> {
    const reply = await sendToOffscreen({ kind });
    if (reply.kind === "error") {
      throw new CaptureError(reply.message, reply.code);
    }
  }

  /**
   * Stops capture and playback but deliberately leaves the offscreen document (and its
   * loaded model) running: closing it would unload the model, forcing the ~40-80s model
   * load to happen again on the next Start even when the model hasn't changed. Only a
   * model change (which requires being idle first, see service-worker.ts's setModel)
   * should pay that cost, and EngineRouter scopes the unload/reload to just that case.
   */
  async stop(): Promise<void> {
    chrome.tabs.onRemoved.removeListener(this.onTabRemoved);
    this.sourceTabId = null;
    await sendToOffscreen({ kind: "stop-capture" }).catch(() => {
      // Offscreen document may already be gone (e.g. closed independently); stopping
      // is still a success from the caller's perspective since nothing is capturing.
    });
  }
}

import {
  envelope,
  isEnvelope,
  type BackgroundToOffscreen,
  type OffscreenReply,
} from "../domain/messages";
import type { ModelId } from "../domain/models";
import type { AsrWorkerEvent } from "../worker/worker-protocol";
import { createAsrWorkerClient, type AsrWorkerClient } from "./asr-worker-client";
import { startTabCapture, type StartCaptureResult } from "./capture";

let active: StartCaptureResult | null = null;

// The worker is created on first use, not at document load: it's cheap, but nothing
// needs it until a model is requested.
let asrWorker: AsrWorkerClient | null = null;
const asrEventListeners = new Set<(event: AsrWorkerEvent) => void>();
const getAsrWorker = (): AsrWorkerClient =>
  (asrWorker ??= createAsrWorkerClient((event) => {
    for (const listener of asrEventListeners) listener(event);
  }));

/** Resolves once the worker's engine reports "ready" (ok) or "error" for the requested load. */
const loadModel = (modelId: ModelId): Promise<OffscreenReply> =>
  new Promise((resolve) => {
    const listener = (event: AsrWorkerEvent) => {
      if (event.kind !== "engine-status") return;
      const { status } = event;
      if (status.state === "ready") resolve({ kind: "ok" });
      else if (status.state === "error") resolve({ kind: "error", code: "model-load-failed", message: status.message });
      else return;
      asrEventListeners.delete(listener);
    };
    asrEventListeners.add(listener);
    getAsrWorker().send({ kind: "load-model", modelId });
  });

const handleMessage = async (msg: BackgroundToOffscreen): Promise<OffscreenReply> => {
  switch (msg.kind) {
    case "start-capture": {
      active?.stop();
      try {
        active = await startTabCapture(msg.streamId);
        return { kind: "ok" };
      } catch (err) {
        active = null;
        const message = err instanceof Error ? err.message : "Unknown capture error.";
        return { kind: "error", code: "capture-failed", message };
      }
    }
    case "stop-capture": {
      active?.stop();
      active = null;
      return { kind: "ok" };
    }
    case "load-model":
      return loadModel(msg.modelId);
    case "unload-model": {
      getAsrWorker().send({ kind: "unload-model" });
      return { kind: "ok" };
    }
    case "pause":
    case "resume":
      // Audio -> worker wiring (and so pause/resume of it) lands in Phase 6.
      return { kind: "ok" };
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isEnvelope<BackgroundToOffscreen>(message)) return undefined;
  handleMessage(message.payload).then((reply) => sendResponse(envelope(reply)));
  return true; // keep the channel open for the async reply
});

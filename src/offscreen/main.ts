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
import { startPcmStream, type PcmStream } from "./pcm-stream";

let active: StartCaptureResult | null = null;
let pcm: PcmStream | null = null;
/** While paused, captured audio keeps playing to the speakers but is not sent to the ASR worker. */
let paused = false;

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

/** Tears down capture and the PCM tap, and has the worker finalize whatever utterance was in progress. */
const stopCapture = () => {
  pcm?.stop();
  pcm = null;
  active?.stop();
  active = null;
  paused = false;
  asrWorker?.send({ kind: "flush" });
};

const handleMessage = async (msg: BackgroundToOffscreen): Promise<OffscreenReply> => {
  switch (msg.kind) {
    case "start-capture": {
      stopCapture();
      try {
        active = await startTabCapture(msg.streamId);
        pcm = await startPcmStream(active.sourceNode.mediaStream, (samples) => {
          if (!paused) getAsrWorker().sendAudio(samples);
        });
        return { kind: "ok" };
      } catch (err) {
        stopCapture();
        const message = err instanceof Error ? err.message : "Unknown capture error.";
        return { kind: "error", code: "capture-failed", message };
      }
    }
    case "stop-capture": {
      stopCapture();
      return { kind: "ok" };
    }
    case "load-model":
      return loadModel(msg.modelId);
    case "unload-model": {
      getAsrWorker().send({ kind: "unload-model" });
      return { kind: "ok" };
    }
    case "pause": {
      paused = true;
      asrWorker?.send({ kind: "flush" });
      return { kind: "ok" };
    }
    case "resume": {
      paused = false;
      return { kind: "ok" };
    }
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

import {
  envelope,
  isEnvelope,
  type BackgroundToOffscreen,
  type OffscreenReply,
  type OffscreenToBackground,
} from "../domain/messages";
import { isFromServiceWorker } from "../domain/sender";
import type { ModelId } from "../domain/models";
import type { ApiKeyProvider } from "../domain/api-key";
import type { AsrWorkerEvent } from "../worker/worker-protocol";
import { createAsrWorkerClient, type AsrWorkerClient } from "./asr-worker-client";
import { startTabCapture, type StartCaptureResult } from "./capture";
import { startPcmStream, type PcmStream } from "./pcm-stream";

let active: StartCaptureResult | null = null;
let pcm: PcmStream | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
/**
 * Counters behind the popup's diagnostics. Without them, "capturing but nothing typed" gives
 * no way to tell silent capture from audio the VAD ignores from audio dropped before a model
 * is ready. `peakLevel` resets each report so it reflects recent audio, not an all-time max.
 */
const stats = { batches: 0, droppedBatches: 0, peakLevel: 0 };

const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
};
/** While paused, captured audio keeps playing to the speakers but is not sent to the ASR worker. */
let paused = false;
/** Mirrors the worker's engine status; audio sent before it is ready would just be dropped. */
let engineReady = false;

// The worker is created on first use, not at document load: it's cheap, but nothing
// needs it until a model is requested.
let asrWorker: AsrWorkerClient | null = null;
let chunkMs: number | null = null;
/** Same reason as chunkMs: the worker may not exist yet when a key is set, and is
 * re-supplied on creation so a key entered before capture starts is not lost. */
let apiKeys: Partial<Record<ApiKeyProvider, string>> = {};
const asrEventListeners = new Set<(event: AsrWorkerEvent) => void>();

const sendToBackground = (message: OffscreenToBackground) => {
  // The service worker is woken by an incoming message, so a rejection here means the
  // extension is shutting down or reloading; there is nobody left to report to.
  void chrome.runtime.sendMessage(envelope(message)).catch(() => {});
};

const getAsrWorker = (): AsrWorkerClient => {
  if (asrWorker) return asrWorker;
  asrWorker = createWorker();
  if (chunkMs !== null) asrWorker.send({ kind: "set-chunk-ms", chunkMs });
  for (const [provider, apiKey] of Object.entries(apiKeys) as [ApiKeyProvider, string][]) {
    asrWorker.send({ kind: "set-api-key", provider, apiKey });
  }
  return asrWorker;
};

const createWorker = (): AsrWorkerClient =>
  createAsrWorkerClient((event) => {
    for (const listener of asrEventListeners) listener(event);
    if (event.kind === "transcript-event") sendToBackground({ kind: "transcript-event", event: event.event });
    else if (event.kind === "engine-status") {
      engineReady = event.status.state === "ready";
      sendToBackground({ kind: "engine-status", status: event.status });
    } else if (event.kind === "connection-status") sendToBackground({ kind: "connection-status", status: event.status });
    else if (event.kind === "inference-stats") sendToBackground({ kind: "inference-stats", stats: event.stats });
    else if (event.kind === "download-progress")
      sendToBackground({
        kind: "model-download-progress",
        modelId: event.modelId,
        receivedBytes: event.receivedBytes,
        totalBytes: event.totalBytes,
      });
  });

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

/**
 * Tears down capture and the PCM tap, and has the worker drop whatever utterance was in
 * progress or still queued. Inference runs slower than real time, so a stopped session can
 * have finals pending; they would otherwise be transcribed and typed after the user stopped
 * listening, or into the next session. Dropping them is the point — Stop means nothing more
 * is typed. (Pause, by contrast, flushes: the words already spoken are still wanted.)
 */
const stopCapture = () => {
  if (statsTimer !== null) clearInterval(statsTimer);
  statsTimer = null;
  stats.batches = 0;
  stats.droppedBatches = 0;
  stats.peakLevel = 0;
  pcm?.stop();
  pcm = null;
  active?.stop();
  active = null;
  paused = false;
  asrWorker?.send({ kind: "reset" });
};

const handleMessage = async (msg: BackgroundToOffscreen): Promise<OffscreenReply> => {
  switch (msg.kind) {
    case "start-capture": {
      stopCapture(); // also drops the previous session's queued finals
      try {
        active = await startTabCapture(msg.streamId, () => {
          stopCapture();
          sendToBackground({ kind: "capture-ended" });
        });
        pcm = await startPcmStream(active.audioContext, active.sourceNode, (samples) => {
          stats.batches++;
          stats.peakLevel = Math.max(stats.peakLevel, peakOf(samples));
          if (paused) return;
          // The worker drops audio until its engine is ready; count that here so the
          // popup can distinguish "no audio" from "audio with nowhere to go yet".
          if (engineReady) getAsrWorker().sendAudio(samples);
          else stats.droppedBatches++;
        });
        statsTimer = setInterval(() => {
          sendToBackground({ kind: "pipeline-stats", ...stats });
          stats.peakLevel = 0;
        }, 1000);
        return { kind: "ok" };
      } catch (err) {
        stopCapture();
        const detail = err instanceof Error ? err.message : "Unknown capture error.";
        return {
          kind: "error",
          code: "capture-failed",
          message: `Chrome would not open the captured tab's audio stream. (${detail})`,
        };
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
    case "set-chunk-ms": {
      // Remembered as well as forwarded: the worker may not exist yet, and is re-tuned on
      // creation so a setting changed before capture starts is not lost.
      chunkMs = msg.chunkMs;
      asrWorker?.send({ kind: "set-chunk-ms", chunkMs });
      return { kind: "ok" };
    }
    case "set-api-key": {
      apiKeys = { ...apiKeys, [msg.provider]: msg.apiKey };
      asrWorker?.send({ kind: "set-api-key", provider: msg.provider, apiKey: msg.apiKey });
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
    case "get-capture-status":
      return { kind: "capture-status", capturing: active !== null, paused };
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // runtime.sendMessage reaches every extension context; only the service worker may
  // drive capture. (The popup's own requests share some `kind` names, e.g. "stop-capture".)
  if (!isEnvelope<BackgroundToOffscreen>(message) || !isFromServiceWorker(sender)) return undefined;
  handleMessage(message.payload).then((reply) => sendResponse(envelope(reply)));
  return true; // keep the channel open for the async reply
});

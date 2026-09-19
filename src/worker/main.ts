/**
 * ASR worker entry. Must be built as a *classic* (IIFE) script, not an ES module:
 * whisper.cpp's Emscripten glue spawns each pthread as `new Worker(self.location.href,
 * { name: "em-pthread" })`, i.e. it re-runs *this same script* in every pthread worker.
 * Those instances must do nothing except load the glue (see docs/whisper-wasm-provenance.md).
 */
import { EnergyVad } from "./energy-vad";
import { TranscriptStabilizer } from "./stabilizer";
import { StreamingTranscriber } from "./streaming-transcriber";
import { WhisperCppEngine } from "./whisper-cpp-engine";
import { loadWhisperModuleFactory } from "./whisper-module";
import { createAsrWorkerController } from "./asr-worker-controller";
import { MODEL_URLS } from "./model-urls";
import type { AsrWorkerEvent, AsrWorkerRequest } from "./worker-protocol";

// Emitted to dist/ by the build (see vite.config.ts); absolute so pthread workers resolve it identically.
const WHISPER_GLUE_URL = new URL("/whisper/libmain.js", self.location.origin).href;

if (self.name === "em-pthread") {
  importScripts(WHISPER_GLUE_URL);
} else {
  const post = (event: AsrWorkerEvent) => self.postMessage(event);

  const engine = new WhisperCppEngine({
    loadModuleFactory: () => loadWhisperModuleFactory(WHISPER_GLUE_URL),
    modelUrls: MODEL_URLS,
    onDownloadProgress: (progress) => post({ kind: "download-progress", ...progress }),
  });
  const transcriber = new StreamingTranscriber({
    engine,
    vad: new EnergyVad(),
    stabilizer: new TranscriptStabilizer(),
    onEvent: (event) => post({ kind: "transcript-event", event }),
  });
  const controller = createAsrWorkerController({ engine, transcriber, post });

  self.onmessage = (message: MessageEvent<AsrWorkerRequest>) => {
    controller.handle(message.data).catch((err: unknown) => {
      post({
        kind: "transcript-event",
        event: {
          type: "error",
          code: "worker-failed",
          message: err instanceof Error ? err.message : "The transcription worker failed.",
        },
      });
    });
  };
}

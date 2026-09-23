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
import { createInstrumentedEngine } from "./instrumented-engine";
import { MODEL_URLS } from "./model-urls";
import { createDownloadProgressReporter } from "./download-progress-reporter";
import type { ModelId } from "../domain/models";
import type { AsrWorkerEvent, AsrWorkerRequest } from "./worker-protocol";

// Emitted to dist/ by the build (see vite.config.ts); absolute so pthread workers resolve it identically.
const WHISPER_GLUE_URL = new URL("/whisper/libmain.js", self.location.origin).href;

if (self.name === "em-pthread") {
  importScripts(WHISPER_GLUE_URL);
} else {
  const post = (event: AsrWorkerEvent) => self.postMessage(event);

  // Throttled: the downloader reports every chunk, which for a ~142 MB model would be
  // thousands of postMessages (each then broadcast on to the service worker and popup).
  const reportProgress = createDownloadProgressReporter<{ modelId: ModelId; receivedBytes: number; totalBytes: number }>(
    (progress) => post({ kind: "download-progress", ...progress }),
  );
  // Created once for the life of the worker, not once per load: the glue script may only
  // be importScripts()'d once per global scope (a second import fails with
  // "Identifier 'EmscriptenEH' has already been declared"), which is exactly what happened
  // when a second Start re-loaded the model.
  const moduleFactory = loadWhisperModuleFactory(WHISPER_GLUE_URL);
  const engine = new WhisperCppEngine({
    loadModuleFactory: () => moduleFactory,
    modelUrls: MODEL_URLS,
    onDownloadProgress: reportProgress,
  });
  // Wrapped so the popup can tell "inference never runs" from "inference is slower than
  // the audio it covers" (see instrumented-engine.ts).
  const instrumented = createInstrumentedEngine(engine, (stats) => post({ kind: "inference-stats", stats }));
  const transcriber = new StreamingTranscriber({
    engine: instrumented,
    vad: new EnergyVad(),
    stabilizer: new TranscriptStabilizer(),
    onEvent: (event) => post({ kind: "transcript-event", event }),
  });
  const controller = createAsrWorkerController({ engine: instrumented, transcriber, post });

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

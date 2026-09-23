/** Message contract between the offscreen document and the ASR worker (src/worker/main.ts). */
import type { EngineStatus, ModelId } from "../domain/models";
import type { TranscriptEvent } from "../domain/transcript";
import type { InferenceStats } from "./instrumented-engine";

export type AsrWorkerRequest =
  | { kind: "load-model"; modelId: ModelId }
  | { kind: "unload-model" }
  /** 16 kHz mono float32 PCM; transfer the buffer rather than copying it. */
  | { kind: "audio"; samples: Float32Array }
  /** Finalize any utterance in progress; answered with a "flushed" event once inference has settled. */
  | { kind: "flush" }
  | { kind: "reset" }
  /** Retunes the running pipeline (see domain/tuning.ts). */
  | { kind: "set-chunk-ms"; chunkMs: number };

export type AsrWorkerEvent =
  | { kind: "engine-status"; status: EngineStatus }
  | { kind: "download-progress"; modelId: ModelId; receivedBytes: number; totalBytes: number }
  | { kind: "transcript-event"; event: TranscriptEvent }
  | { kind: "inference-stats"; stats: InferenceStats }
  | { kind: "flushed" };

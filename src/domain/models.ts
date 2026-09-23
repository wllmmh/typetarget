/** Supported Whisper model identifiers for v1. English-only models per AGENTS.md. */
export type ModelId = "tiny.en" | "base.en";

/**
 * tiny.en, not base.en: a cold first run must download the model before anything can be
 * transcribed (~74 MB / ~40 s vs ~142 MB / ~81 s measured in Chrome), and per-utterance
 * inference cost is dominated by Whisper's fixed 30 s window either way. base.en stays
 * one dropdown pick away for accuracy.
 */
export const DEFAULT_MODEL: ModelId = "tiny.en";

export type ModelInfo = {
  id: ModelId;
  label: string;
  approxSizeMb: number;
};

export const MODEL_CATALOG: Record<ModelId, ModelInfo> = {
  "tiny.en": { id: "tiny.en", label: "Tiny (English)", approxSizeMb: 74 }, // measured: 77,704,715 bytes
  "base.en": { id: "base.en", label: "Base (English)", approxSizeMb: 142 }, // not independently verified
};

export type ModelDownloadState =
  | { status: "not-downloaded" }
  | { status: "downloading"; receivedBytes: number; totalBytes: number }
  | { status: "cached" }
  | { status: "error"; message: string };

export type EngineStatus =
  | { state: "unloaded" }
  | { state: "loading"; modelId: ModelId }
  | { state: "ready"; modelId: ModelId }
  | { state: "error"; message: string };

/** Options passed per-inference call; kept minimal and backend-agnostic. */
export type TranscriptionOptions = {
  language?: "en";
};

export type TranscriptionResult = {
  text: string;
  /** Whisper's internal confidence signal where available; backend-specific, treat as opaque. */
  avgLogProb?: number;
};

/**
 * Backend-agnostic ASR contract. Nothing outside `src/worker` and the offscreen
 * document's engine wiring may depend on whisper.cpp internals directly — everything
 * else talks to this interface, so a WebGPU or native backend can be swapped in later
 * (see AGENTS.md "Model abstraction").
 */
export interface TranscriptionEngine {
  load(model: ModelId): Promise<void>;
  unload(): Promise<void>;
  transcribe(audio: Float32Array, options?: TranscriptionOptions): Promise<TranscriptionResult>;
  reset(): Promise<void>;
  getStatus(): EngineStatus;
}

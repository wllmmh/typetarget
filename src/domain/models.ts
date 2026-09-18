/** Supported Whisper model identifiers for v1. English-only models per AGENTS.md. */
export type ModelId = "tiny.en" | "base.en";

export const DEFAULT_MODEL: ModelId = "base.en";

export type ModelInfo = {
  id: ModelId;
  label: string;
  approxSizeMb: number;
};

export const MODEL_CATALOG: Record<ModelId, ModelInfo> = {
  "tiny.en": { id: "tiny.en", label: "Tiny (English)", approxSizeMb: 75 },
  "base.en": { id: "base.en", label: "Base (English)", approxSizeMb: 142 },
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

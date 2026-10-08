/**
 * Which transcription backend a model belongs to. See HANDOFF.md "Provider shapes":
 * "whisper-cpp" is local/discrete (one engine.transcribe(chunk) call per utterance,
 * scheduled by StreamingTranscriber's VAD/chunk-length logic). "gemini-live" is a
 * persistent network stream with its own server-side turn detection — engine-router.ts
 * routes each provider through the matching integration shape.
 *
 * "groq" is discrete like whisper-cpp (one POST per utterance to Groq's hosted Whisper),
 * so it reuses StreamingTranscriber's scheduling rather than needing its own streaming shape.
 */
export type EngineProvider = "whisper-cpp" | "gemini-live" | "groq";

/** Whisper.cpp's own model identifiers — split out from ModelId so the download/cache
 * machinery (model-urls.ts, model-downloader.ts, whisper-cpp-engine.ts) that's keyed by
 * "one URL/filename per whisper model" doesn't need an (nonsensical) entry for network
 * providers that have no file to download. English-only per AGENTS.md. */
export type WhisperModelId =
  | "tiny.en"
  | "tiny.en-q5_1"
  | "base.en"
  // "More Whisper models" in the popup: same mirror (model-urls.ts), English-only like the rest.
  | "tiny.en-q8_0"
  | "base.en-q5_1"
  | "base.en-q8_0"
  | "small.en-q5_1"
  | "small.en-q8_0"
  | "small.en"
  | "medium.en-q5_0"
  | "medium.en-q8_0";

/** Model identifiers across all providers. */
export type ModelId = WhisperModelId | "gemini-3.5-transcribe-live" | "groq-whisper-large-v3-turbo" | "groq-whisper-large-v3";

/**
 * tiny.en-q5_1: the smallest download (~31 MB) and, measured in Chrome, ~1.3× faster than
 * tiny.en with an identical transcript (HANDOFF.md "Lever 3"). Local models are one option
 * among several: whether any of them keeps up live depends on the user's machine, and most
 * won't, so the popup points slow machines at a network model. Network providers are still
 * never the default — sending audio off-device must be a deliberate choice, and they need
 * the user's own API key.
 */
export const DEFAULT_MODEL: ModelId = "tiny.en-q5_1";

export type ModelInfo = {
  id: ModelId;
  provider: EngineProvider;
  /** The provider's own name, e.g. "Whisper" / "Gemini" — shown in the model picker
   * alongside `label` so multiple providers' models aren't visually indistinguishable. */
  name: string;
  /** Variant/size within the provider, e.g. "Tiny (English)" / "3.5 Transcribe (Live)". */
  label: string;
  /** Only local models have a fixed download size. */
  approxSizeMb?: number;
  /** True if selecting this model sends captured audio off-device. Drives the popup's
   * notice under the model picker. */
  network?: boolean;
  requiresApiKey?: boolean;
};

export const MODEL_CATALOG: Record<ModelId, ModelInfo> = {
  "tiny.en": { id: "tiny.en", provider: "whisper-cpp", name: "Whisper", label: "Tiny (English)", approxSizeMb: 74 }, // measured: 77,704,715 bytes
  // 5-bit quantized tiny.en, same architecture: smaller download and ~1.3× faster inference,
  // same transcript (measured, HANDOFF.md "Lever 3"). The default.
  "tiny.en-q5_1": {
    id: "tiny.en-q5_1",
    provider: "whisper-cpp",
    name: "Whisper",
    label: "Tiny Q5 (English, quantized)",
    approxSizeMb: 31, // measured: 32,166,155 bytes
  },
  "tiny.en-q8_0": { id: "tiny.en-q8_0", provider: "whisper-cpp", name: "Whisper", label: "Tiny Q8 (English, quantized)", approxSizeMb: 42 }, // 43,550,795 bytes
  "base.en": { id: "base.en", provider: "whisper-cpp", name: "Whisper", label: "Base (English)", approxSizeMb: 142 }, // not independently verified
  "base.en-q5_1": { id: "base.en-q5_1", provider: "whisper-cpp", name: "Whisper", label: "Base Q5 (English, quantized)", approxSizeMb: 57 }, // 59,721,011 bytes
  "base.en-q8_0": { id: "base.en-q8_0", provider: "whisper-cpp", name: "Whisper", label: "Base Q8 (English, quantized)", approxSizeMb: 78 }, // 81,781,811 bytes
  // The rest of the mirror's English-only files the vendored build can hold, each family kept
  // together in the popup's list (Tiny Q8 and Base Q5/Q8 sit above with their families).
  // Sizes are the mirror's listed byte counts (2026-10-08), in MiB like the ones above. Larger
  // models transcribe more accurately but far slower — this build is single-threaded, so whether
  // even tiny.en keeps up live depends on the machine (HANDOFF.md) — so none is a default. The vendored WASM
  // heap tops out near 2 GB (measured: 512 MB initial, growable to ~1.94 GiB), which rules out
  // the full-precision medium.en (1.46 GiB of weights before working memory) and every large
  // model; whether Medium Q8 fits alongside its working memory is unverified.
  "small.en-q5_1": { id: "small.en-q5_1", provider: "whisper-cpp", name: "Whisper", label: "Small Q5 (English, quantized)", approxSizeMb: 181 }, // 190,098,681 bytes
  "small.en-q8_0": { id: "small.en-q8_0", provider: "whisper-cpp", name: "Whisper", label: "Small Q8 (English, quantized)", approxSizeMb: 252 }, // 264,477,561 bytes
  "small.en": { id: "small.en", provider: "whisper-cpp", name: "Whisper", label: "Small (English)", approxSizeMb: 465 }, // 487,614,201 bytes
  "medium.en-q5_0": { id: "medium.en-q5_0", provider: "whisper-cpp", name: "Whisper", label: "Medium Q5 (English, quantized)", approxSizeMb: 514 }, // 539,225,533 bytes
  "medium.en-q8_0": { id: "medium.en-q8_0", provider: "whisper-cpp", name: "Whisper", label: "Medium Q8 (English, quantized)", approxSizeMb: 785 }, // 823,382,461 bytes
  // Google's Gemini 3.5 Transcribe, via the Live API (persistent WebSocket, not the
  // simpler batch Files-API alternative — see HANDOFF.md for why). Confirmed working with a
  // real key by the user (2026-10-08). Sends captured audio to Google using the user's own API key.
  "gemini-3.5-transcribe-live": {
    id: "gemini-3.5-transcribe-live",
    provider: "gemini-live",
    name: "Gemini",
    label: "3.5 Transcribe (Live)",
    network: true,
    requiresApiKey: true,
  },
  // Groq's hosted Whisper (see GROQ.md). Multilingual models, pinned to English like the
  // rest of the app. Sends each finalized utterance to Groq using the user's own key.
  "groq-whisper-large-v3-turbo": {
    id: "groq-whisper-large-v3-turbo",
    provider: "groq",
    name: "Groq",
    label: "Whisper Large v3 Turbo",
    network: true,
    requiresApiKey: true,
  },
  "groq-whisper-large-v3": {
    id: "groq-whisper-large-v3",
    provider: "groq",
    name: "Groq",
    label: "Whisper Large v3",
    network: true,
    requiresApiKey: true,
  },
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

/**
 * A network engine's live connection, reported alongside (not instead of) EngineStatus:
 * the engine stays "ready" while it reconnects, buffering audio, so nothing upstream stops
 * feeding it. `since` is when the current connection opened (epoch ms); `reconnects`
 * counts the connections opened since the engine was loaded, after the first.
 */
export type ConnectionStatus =
  | { state: "connected"; since: number; reconnects: number }
  | { state: "reconnecting"; attempt: number; reason: string };

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

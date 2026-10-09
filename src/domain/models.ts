/**
 * Which transcription backend a model belongs to; engine-router.ts dispatches on it.
 * "whisper-cpp" (local) and "groq" (one POST per utterance) are discrete: one
 * engine.transcribe(chunk) call per utterance, scheduled by StreamingTranscriber's VAD and
 * chunk-length logic. "gemini-live" streams audio over a persistent connection and marks
 * utterance boundaries itself. See docs/adr/0004-pluggable-transcription-engines.md.
 */
export type EngineProvider = "whisper-cpp" | "gemini-live" | "groq";

/** Whisper.cpp's own model identifiers — split out from ModelId so the download/cache
 * machinery (model-urls.ts, model-downloader.ts, whisper-cpp-engine.ts) that's keyed by
 * "one URL/filename per whisper model" doesn't need an (nonsensical) entry for network
 * providers that have no file to download. English-only, like the rest of the app. */
export type WhisperModelId =
  | "tiny.en"
  | "tiny.en-q5_1"
  | "base.en"
  // Quantized and larger variants, from the same mirror (model-urls.ts).
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
 * tiny.en with an identical transcript. Network providers are never the default: sending
 * audio off-device must be a deliberate choice, and they need the user's own API key.
 * See docs/adr/0010-hosted-models-for-live-transcription.md.
 */
export const DEFAULT_MODEL: ModelId = "tiny.en-q5_1";

export type ModelInfo = {
  id: ModelId;
  provider: EngineProvider;
  /** The provider's name, e.g. "Local" / "Groq" — shown in the model picker
   * alongside `label` so multiple providers' models aren't visually indistinguishable. */
  name: string;
  /** Variant/size within the provider, e.g. "Whisper Tiny (English)" / "Gemini 3.5 Transcribe Live". */
  label: string;
  /** Only local models have a fixed download size. */
  approxSizeMb?: number;
  /** True if selecting this model sends captured audio off-device. Drives the popup's
   * notice under the model picker. */
  network?: boolean;
  requiresApiKey?: boolean;
};

export const MODEL_CATALOG: Record<ModelId, ModelInfo> = {
  "tiny.en": { id: "tiny.en", provider: "whisper-cpp", name: "Local", label: "Whisper Tiny (English)", approxSizeMb: 74 }, // measured: 77,704,715 bytes
  // 5-bit quantized tiny.en: smaller download, ~1.3× faster, same transcript. The default.
  "tiny.en-q5_1": {
    id: "tiny.en-q5_1",
    provider: "whisper-cpp",
    name: "Local",
    label: "Whisper Tiny Q5 (English, quantized)",
    approxSizeMb: 31, // measured: 32,166,155 bytes
  },
  "tiny.en-q8_0": { id: "tiny.en-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Tiny Q8 (English, quantized)", approxSizeMb: 42 }, // 43,550,795 bytes
  "base.en": { id: "base.en", provider: "whisper-cpp", name: "Local", label: "Whisper Base (English)", approxSizeMb: 142 }, // not independently verified
  "base.en-q5_1": { id: "base.en-q5_1", provider: "whisper-cpp", name: "Local", label: "Whisper Base Q5 (English, quantized)", approxSizeMb: 57 }, // 59,721,011 bytes
  "base.en-q8_0": { id: "base.en-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Base Q8 (English, quantized)", approxSizeMb: 78 }, // 81,781,811 bytes
  // The rest of the mirror's English-only files that fit the vendored build's ~2 GB WASM heap
  // (full-precision medium.en and the large models don't). Sizes in MiB from the mirror's byte
  // counts. Whether Medium Q8 fits alongside its working memory is unverified.
  "small.en-q5_1": { id: "small.en-q5_1", provider: "whisper-cpp", name: "Local", label: "Whisper Small Q5 (English, quantized)", approxSizeMb: 181 }, // 190,098,681 bytes
  "small.en-q8_0": { id: "small.en-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Small Q8 (English, quantized)", approxSizeMb: 252 }, // 264,477,561 bytes
  "small.en": { id: "small.en", provider: "whisper-cpp", name: "Local", label: "Whisper Small (English)", approxSizeMb: 465 }, // 487,614,201 bytes
  "medium.en-q5_0": { id: "medium.en-q5_0", provider: "whisper-cpp", name: "Local", label: "Whisper Medium Q5 (English, quantized)", approxSizeMb: 514 }, // 539,225,533 bytes
  "medium.en-q8_0": { id: "medium.en-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Medium Q8 (English, quantized)", approxSizeMb: 785 }, // 823,382,461 bytes
  // Google's Gemini 3.5 Transcribe via the Live API (docs/adr/0005-gemini-live-api-via-official-sdk.md).
  // Sends captured audio to Google using the user's own API key.
  "gemini-3.5-transcribe-live": {
    id: "gemini-3.5-transcribe-live",
    provider: "gemini-live",
    name: "Google",
    label: "Gemini 3.5 Transcribe Live",
    network: true,
    requiresApiKey: true,
  },
  // Groq's hosted Whisper (docs/specs/groq-speech-to-text.md). Multilingual models, pinned to English like the
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
 * Backend-agnostic ASR contract. Only the engine modules in `src/worker` know a
 * provider's internals; everything else talks to this interface, so backends can be
 * added or swapped without touching the pipeline.
 */
export interface TranscriptionEngine {
  load(model: ModelId): Promise<void>;
  unload(): Promise<void>;
  transcribe(audio: Float32Array, options?: TranscriptionOptions): Promise<TranscriptionResult>;
  reset(): Promise<void>;
  getStatus(): EngineStatus;
}

import type { ApiKeyProvider } from "./api-key";

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
 * providers that have no file to download. All multilingual; the mirror's English-only
 * (`.en`) files are not offered. */
export type WhisperModelId =
  | "tiny-q5_1"
  | "tiny-q8_0"
  | "tiny"
  | "base-q5_1"
  | "base-q8_0"
  | "base"
  | "small-q5_1"
  | "small-q8_0"
  | "small"
  | "medium-q5_0"
  | "medium-q8_0"
  | "large-v3-turbo-q5_0"
  | "large-v3-turbo-q8_0"
  | "large-v2-q5_0"
  | "large-v3-q5_0";

/** Model identifiers across all providers. */
export type ModelId = WhisperModelId | "gemini-3.5-transcribe-live" | "groq-whisper-large-v3-turbo" | "groq-whisper-large-v3";

/**
 * tiny-q5_1: the smallest download (~31 MB). Its English-only twin measured ~1.3× faster than
 * full-precision tiny in Chrome, with an identical transcript. Network providers are never the default: sending
 * audio off-device must be a deliberate choice, and they need the user's own API key.
 * See docs/adr/0010-hosted-models-for-live-transcription.md.
 */
export const DEFAULT_MODEL: ModelId = "tiny-q5_1";

export type ModelInfo = {
  id: ModelId;
  provider: EngineProvider;
  /** The provider's name, e.g. "Local" / "Groq" — shown in the model picker
   * alongside `label` so multiple providers' models aren't visually indistinguishable. */
  name: string;
  /** Variant/size within the provider, e.g. "Whisper Tiny Q5" / "Gemini 3.5 Transcribe Live". */
  label: string;
  /** Only local models have a fixed download size. */
  approxSizeMb?: number;
  /** True if selecting this model sends captured audio off-device. Drives the popup's
   * notice under the model picker. */
  network?: boolean;
  requiresApiKey?: boolean;
};

export const MODEL_CATALOG: Record<ModelId, ModelInfo> = {
  // 5-bit quantized tiny: the smallest download and the fastest. The default.
  "tiny-q5_1": { id: "tiny-q5_1", provider: "whisper-cpp", name: "Local", label: "Whisper Tiny Q5", approxSizeMb: 31 }, // 32,152,673 bytes
  "tiny-q8_0": { id: "tiny-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Tiny Q8", approxSizeMb: 42 }, // 43,537,433 bytes
  "tiny": { id: "tiny", provider: "whisper-cpp", name: "Local", label: "Whisper Tiny", approxSizeMb: 74 }, // 77,691,713 bytes
  "base-q5_1": { id: "base-q5_1", provider: "whisper-cpp", name: "Local", label: "Whisper Base Q5", approxSizeMb: 57 }, // 59,707,625 bytes
  "base-q8_0": { id: "base-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Base Q8", approxSizeMb: 78 }, // 81,768,585 bytes
  "base": { id: "base", provider: "whisper-cpp", name: "Local", label: "Whisper Base", approxSizeMb: 141 }, // 147,951,465 bytes
  "small-q5_1": { id: "small-q5_1", provider: "whisper-cpp", name: "Local", label: "Whisper Small Q5", approxSizeMb: 181 }, // 190,085,487 bytes
  "small-q8_0": { id: "small-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Small Q8", approxSizeMb: 252 }, // 264,464,607 bytes
  "small": { id: "small", provider: "whisper-cpp", name: "Local", label: "Whisper Small", approxSizeMb: 465 }, // 487,601,967 bytes
  // Only the files that fit the vendored build's ~2 GB WASM heap: full-precision medium
  // (1.43 GiB) and large-v3-turbo (1.51 GiB), large-v2 Q8 (1.54 GiB) and every full-precision
  // large model (2.88 GiB) don't. Whether Medium Q8 and the large models fit alongside their
  // working memory is unverified. Sizes in MiB from the mirror's byte counts.
  "medium-q5_0": { id: "medium-q5_0", provider: "whisper-cpp", name: "Local", label: "Whisper Medium Q5", approxSizeMb: 514 }, // 539,212,467 bytes
  "medium-q8_0": { id: "medium-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Medium Q8", approxSizeMb: 785 }, // 823,369,779 bytes
  "large-v3-turbo-q5_0": { id: "large-v3-turbo-q5_0", provider: "whisper-cpp", name: "Local", label: "Whisper Large v3 Turbo Q5", approxSizeMb: 547 }, // 574,041,195 bytes
  "large-v3-turbo-q8_0": { id: "large-v3-turbo-q8_0", provider: "whisper-cpp", name: "Local", label: "Whisper Large v3 Turbo Q8", approxSizeMb: 834 }, // 874,188,075 bytes
  "large-v2-q5_0": { id: "large-v2-q5_0", provider: "whisper-cpp", name: "Local", label: "Whisper Large v2 Q5", approxSizeMb: 1031 }, // 1,080,732,091 bytes
  "large-v3-q5_0": { id: "large-v3-q5_0", provider: "whisper-cpp", name: "Local", label: "Whisper Large v3 Q5", approxSizeMb: 1031 }, // 1,081,140,203 bytes
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
  // Groq's hosted Whisper (docs/specs/groq-speech-to-text.md). Multilingual models; the spoken
  // language is detected per utterance. Sends each finalized utterance to Groq using the user's
  // own key.
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
  /** The spoken language as an ISO 639-1 code. Omitted, the engine detects it from the audio
   * (docs/adr/0016-transcription-detects-the-spoken-language.md). */
  language?: string;
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

/** The provider whose key this model needs; null for local models. */
export const keyProviderOf = ({ provider, requiresApiKey }: ModelInfo): ApiKeyProvider | null =>
  requiresApiKey && provider !== "whisper-cpp" ? provider : null;

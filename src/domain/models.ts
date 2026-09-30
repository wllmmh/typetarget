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
export type WhisperModelId = "tiny.en" | "tiny.en-q5_1" | "base.en";

/** Model identifiers across all providers. */
export type ModelId = WhisperModelId | "gemini-3.5-transcribe-live" | "groq-whisper-large-v3-turbo" | "groq-whisper-large-v3";

/**
 * tiny.en, not base.en: a cold first run must download the model before anything can be
 * transcribed (~74 MB / ~40 s vs ~142 MB / ~81 s measured in Chrome), and per-utterance
 * inference cost is dominated by Whisper's fixed 30 s window either way. base.en stays
 * one dropdown pick away for accuracy. Network providers are opt-in, never the default —
 * both because they are unverified in this codebase and because sending audio off-device
 * must be a deliberate user choice, not a silent default.
 */
export const DEFAULT_MODEL: ModelId = "tiny.en";

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
   * privacy notice — see HANDOFF.md "API key". */
  network?: boolean;
  requiresApiKey?: boolean;
};

export const MODEL_CATALOG: Record<ModelId, ModelInfo> = {
  "tiny.en": { id: "tiny.en", provider: "whisper-cpp", name: "Whisper", label: "Tiny (English)", approxSizeMb: 74 }, // measured: 77,704,715 bytes
  // 5-bit quantized tiny.en, same architecture, smaller/faster download only — inference
  // speed is unverified (quantization trades memory bandwidth for CPU dequant cost; see
  // HANDOFF.md "Lever 3"). Offered as a user-chosen option, not the default, until measured.
  "tiny.en-q5_1": {
    id: "tiny.en-q5_1",
    provider: "whisper-cpp",
    name: "Whisper",
    label: "Tiny Q5 (English, quantized)",
    approxSizeMb: 31, // measured: 32,166,155 bytes
  },
  "base.en": { id: "base.en", provider: "whisper-cpp", name: "Whisper", label: "Base (English)", approxSizeMb: 142 }, // not independently verified
  // Google's Gemini 3.5 Transcribe, via the Live API (persistent WebSocket, not the
  // simpler batch Files-API alternative — see HANDOFF.md for why). Unverified end to end
  // in this codebase: no real API key/browser available to test against the real
  // service. Sends captured audio to Google using the user's own API key.
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

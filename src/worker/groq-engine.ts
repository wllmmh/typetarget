/**
 * TranscriptionEngine backed by Groq's hosted Whisper (OpenAI-compatible
 * `/audio/transcriptions` endpoint — see docs/specs/groq-speech-to-text.md, a snapshot of
 * Groq's docs). Same discrete shape as WhisperCppEngine: one transcribe(chunk) call per utterance,
 * scheduled by a StreamingTranscriber's VAD/chunk-length logic, so it needs no streaming
 * shape of its own (contrast gemini-live-engine.ts).
 *
 * Each utterance is uploaded as a 16 kHz mono 16-bit WAV (Groq resamples to exactly that
 * anyway, and its docs recommend WAV for latency). Sends captured audio to Groq using the
 * user's own key.
 */
import {
  MODEL_CATALOG,
  type EngineStatus,
  type ModelId,
  type TranscriptionEngine,
  type TranscriptionOptions,
  type TranscriptionResult,
} from "../domain/models";
import { float32ToWav } from "./pcm16-encode";
import { SAMPLE_RATE } from "./streaming-transcriber";

export const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/** TypeTarget's model ids → Groq's own model ids (Groq docs, "Supported Models"). Prefixed on
 * our side so they can't be confused with the local whisper.cpp models in the picker. */
const GROQ_MODEL_IDS: Partial<Record<ModelId, string>> = {
  "groq-whisper-large-v3-turbo": "whisper-large-v3-turbo",
  "groq-whisper-large-v3": "whisper-large-v3",
};

const NO_API_KEY_MESSAGE = "Set a Groq API key first (see the popup's API Keys dialog).";

export type GroqEngineConfig = {
  /** Reads whatever key is currently stored for Groq, at each request, so a key changed
   * mid-session applies to the next utterance (same contract as GeminiLiveEngine). */
  getApiKey: () => string | null;
  fetch?: typeof fetch;
};

/** Narrows Groq's JSON response (`response_format: "json"` → `{ text }`) without trusting it. */
const readText = (body: unknown): string => {
  if (typeof body === "object" && body !== null && "text" in body && typeof body.text === "string") return body.text;
  throw new Error("Groq returned an unexpected response.");
};

/** Groq's OpenAI-style error body is `{ error: { message } }`; fall back to the status line. */
const readErrorMessage = (body: unknown, status: number): string => {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return `HTTP ${status}`;
};

export class GroqEngine implements TranscriptionEngine {
  private status: EngineStatus = { state: "unloaded" };
  private groqModel: string | null = null;

  constructor(private readonly config: GroqEngineConfig) {}

  async load(modelId: ModelId): Promise<void> {
    const groqModel = MODEL_CATALOG[modelId].provider === "groq" ? GROQ_MODEL_IDS[modelId] : undefined;
    if (!groqModel) {
      this.status = { state: "error", message: `GroqEngine cannot load non-Groq model "${modelId}".` };
      throw new Error(this.status.message);
    }
    // Nothing to download or connect: the key is checked here only so a missing one is
    // reported at Start instead of at the first utterance.
    if (!this.config.getApiKey()) {
      this.status = { state: "error", message: NO_API_KEY_MESSAGE };
      throw new Error(NO_API_KEY_MESSAGE);
    }
    this.groqModel = groqModel;
    this.status = { state: "ready", modelId };
  }

  async unload(): Promise<void> {
    this.groqModel = null;
    this.status = { state: "unloaded" };
  }

  async transcribe(audio: Float32Array, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    if (!this.groqModel) throw new Error("Groq model is not loaded.");
    const apiKey = this.config.getApiKey();
    if (!apiKey) throw new Error(NO_API_KEY_MESSAGE);

    const form = new FormData();
    form.append("file", new Blob([float32ToWav(audio, SAMPLE_RATE)], { type: "audio/wav" }), "utterance.wav");
    form.append("model", this.groqModel);
    form.append("language", options?.language ?? "en");
    form.append("response_format", "json");
    form.append("temperature", "0");

    const doFetch = this.config.fetch ?? fetch;
    const response = await doFetch(GROQ_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "Groq rejected the API key. Check it in the popup's API Keys dialog."
          : `Groq transcription failed: ${readErrorMessage(body, response.status)}`,
      );
    }
    return { text: readText(body).trim() };
  }

  async reset(): Promise<void> {
    // Stateless per request; nothing to clear.
  }

  getStatus(): EngineStatus {
    return this.status;
  }
}

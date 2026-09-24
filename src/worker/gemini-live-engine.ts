/**
 * TranscriptionEngine implementation backed by Google's Gemini Live API (persistent
 * WebSocket, not the batch Files-API alternative — see HANDOFF.md "Gemini Live" for
 * why). This is the *only* module allowed to know about @google/genai's Live session
 * shape — everything above it talks to TranscriptionEngine (domain/models.ts) plus the
 * narrow streaming shape engine-router.ts also expects of it (pushAudio/flush/setOptions),
 * same boundary whisper-cpp-engine.ts draws around whisper.cpp.
 *
 * Unlike whisper-cpp, this provider has no discrete "one chunk in, one transcript out"
 * call: audio is streamed continuously over an open connection. `transcribe()` therefore
 * exists only to satisfy the TranscriptionEngine interface — engine-router.ts routes
 * pushAudio() directly for this provider and never calls it.
 *
 * Utterance boundaries are marked by *this* client, not Gemini's server-side detection.
 * Measured against the real API (2026-09-23, HANDOFF.md "Gemini Live"): with automatic
 * detection, speech after each detected end was ignored for seconds at a time, losing
 * most of a continuous talk; and the server never sends `turnComplete` for transcription,
 * only `inputTranscription` per utterance. What proved lossless: automatic detection off,
 * `TURN_INCLUDES_ALL_INPUT`, `activityEnd` at a local pause (or the chunk-length cap), and
 * the next `activityStart` only once the server acknowledges the end — an `activityStart`
 * sent before that is silently dropped. Audio keeps streaming throughout; all-input
 * coverage folds the audio sent while waiting for the acknowledgement into the next turn.
 */
import { GoogleGenAI, TurnCoverage, type LiveServerMessage, type VoiceActivity } from "@google/genai";
import type { EngineStatus, ModelId, TranscriptionEngine, TranscriptionOptions, TranscriptionResult } from "../domain/models";
import type { TranscriptEvent } from "../domain/transcript";
import type { VoiceActivityDetector } from "../domain/vad";
import { CHUNK_MS_DEFAULT } from "../domain/tuning";
import type { StreamingOptions } from "./streaming-transcriber";
import { TranscriptStabilizer } from "./stabilizer";
import { EnergyVad } from "./energy-vad";
import { float32ToPcm16Base64 } from "./pcm16-encode";

/** The Live API model id for dedicated transcription (distinct from the batch
 * "gemini-3.5-transcribe" model) — verified against Google's own docs, see
 * HANDOFF.md "Gemini Live". Fixed here rather than exposed as an option: there is
 * exactly one Live+transcription model this engine knows how to talk to. */
const LIVE_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";

/**
 * Narrow structural shape of @google/genai's `Session` (from `client.live.connect(...)`),
 * injected via `connect` below rather than importing the SDK directly here — same DI
 * reasoning as whisper-cpp-engine.ts's `loadModuleFactory`: tests supply a fake session
 * instead of opening a real network connection. Matches the SDK's real
 * `sendRealtimeInput`/`close` methods (verified against the SDK's shipped .d.ts, not
 * scraped docs — see HANDOFF.md).
 */
export type LiveSessionLike = {
  sendRealtimeInput: (
    input: { audio: { data: string; mimeType: string } } | { activityStart: Record<string, never> } | { activityEnd: Record<string, never> },
  ) => void;
  close: () => void;
};

/** Narrowed from @google/genai's LiveServerContent — only the fields this engine reads. */
export type LiveServerContentLike = {
  interimInputTranscription?: { text?: string };
  inputTranscription?: { text?: string };
};

export type LiveSessionCallbacks = {
  onmessage: (message: { serverContent?: LiveServerContentLike; voiceActivity?: "ACTIVITY_START" | "ACTIVITY_END" }) => void;
  onerror?: (event: { message?: string }) => void;
  onclose?: (event: { reason?: string }) => void;
};

export type GeminiLiveEngineConfig = {
  /** Opens a session; resolves once connected. Mirrors @google/genai's
   * `client.live.connect({ model, config, callbacks })`, minus the parts this engine
   * doesn't need callers to vary (model id, transcription config are fixed below). */
  connect: (apiKey: string, callbacks: LiveSessionCallbacks) => Promise<LiveSessionLike>;
  /** Reads whatever key is currently stored for this provider (see domain/api-key.ts);
   * a function rather than a fixed value so a key entered after the worker started is
   * picked up on the next load(), not only at construction time. */
  getApiKey: () => string | null;
  /** Finds the pauses utterances are split at. Injected for tests; EnergyVad by default. */
  vad?: VoiceActivityDetector;
};

/** Bound on how long flush() waits for the server to close the last utterance, so "Stop"
 * can't hang forever on a network hiccup or server-side timeout. */
const FLUSH_TIMEOUT_MS = 5_000;
/** If the server never acknowledges an activityEnd, reopen anyway rather than stop
 * transcribing for the rest of the session. The observed acknowledgement takes ~0.3-0.6 s. */
const ACK_TIMEOUT_MS = 3_000;
const SAMPLE_RATE = 16_000;

export class GeminiLiveEngine implements TranscriptionEngine {
  private status: EngineStatus = { state: "unloaded" };
  private session: LiveSessionLike | null = null;
  private readonly stabilizer = new TranscriptStabilizer();
  private readonly vad: VoiceActivityDetector;
  private awaitingFinal: (() => void) | null = null;
  private maxUtteranceMs = CHUNK_MS_DEFAULT;
  /** Audio sent since the last activityEnd, in samples; compared against maxUtteranceMs. */
  private utteranceSamples = 0;
  private totalSamples = 0;
  /** activityEnd sent, the server's ACTIVITY_END not yet seen; no new activityStart until it is. */
  private awaitingAck = false;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped per connect and on intentional close, so callbacks from an old session are ignored. */
  private connectionId = 0;

  constructor(
    private readonly config: GeminiLiveEngineConfig,
    private readonly onEvent: (event: TranscriptEvent) => void,
  ) {
    this.vad = config.vad ?? new EnergyVad();
  }

  async load(modelId: ModelId): Promise<void> {
    const apiKey = this.config.getApiKey();
    if (!apiKey) {
      this.status = { state: "error", message: "Set a Gemini API key first (see the popup's API Keys dialog)." };
      throw new Error(this.status.message);
    }

    this.closeSession(); // Stop/Start loads again; don't leave the previous socket open
    this.status = { state: "loading", modelId };
    this.resetUtteranceState();
    const connection = ++this.connectionId;
    try {
      const session = await this.config.connect(apiKey, {
        onmessage: (message) => {
          if (connection === this.connectionId) this.handleMessage(message);
        },
        onerror: (event) => {
          if (connection === this.connectionId) this.fail(event.message ?? "Gemini connection error.");
        },
        onclose: (event) => {
          // Previously swallowed: the status stayed "ready" while every later batch of
          // audio was silently dropped.
          if (connection === this.connectionId) this.fail(`Gemini closed the connection${event.reason ? `: ${event.reason}` : "."}`);
        },
      });
      this.session = session;
      session.sendRealtimeInput({ activityStart: {} });
      this.status = { state: "ready", modelId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect to Gemini.";
      this.status = { state: "error", message };
      throw err;
    }
  }

  async unload(): Promise<void> {
    this.closeSession();
    this.status = { state: "unloaded" };
  }

  /** Unreachable via the normal pipeline — see file header. Implemented rather than
   * left absent so the TranscriptionEngine contract holds if that ever changes. */
  async transcribe(_audio: Float32Array, _options?: TranscriptionOptions): Promise<TranscriptionResult> {
    throw new Error("GeminiLiveEngine.transcribe() is not used; audio is streamed via pushAudio().");
  }

  /**
   * Closes and reopens the session so nothing from before the reset can surface
   * afterwards — the same intent as StreamingTranscriber's generation counter
   * (HANDOFF.md: "audio from the last session was transcribed and typed into the next
   * one"), just via connection lifecycle instead of a counter, since there is no local
   * queue here to invalidate.
   */
  async reset(): Promise<void> {
    const modelId = this.status.state === "ready" || this.status.state === "loading" ? this.status.modelId : null;
    this.closeSession();
    this.resetUtteranceState();
    if (modelId) await this.load(modelId);
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  /** Streams one batch of 16 kHz mono PCM directly over the open session, and ends the
   * utterance at a pause or at the chunk-length cap. Dropped silently if not connected,
   * matching how the controller already drops audio pushed before an engine reports
   * "ready" (see asr-worker-controller.ts). */
  pushAudio(samples: Float32Array): void {
    if (!this.session) return;
    this.session.sendRealtimeInput({ audio: { data: float32ToPcm16Base64(samples), mimeType: "audio/pcm;rate=16000" } });
    this.utteranceSamples += samples.length;
    this.totalSamples += samples.length;
    const vadEvent = this.vad.processFrame(samples, (this.totalSamples / SAMPLE_RATE) * 1000);
    if (this.awaitingAck) return;
    if (vadEvent?.type === "speech-end" || (this.utteranceSamples / SAMPLE_RATE) * 1000 >= this.maxUtteranceMs) {
      this.endUtterance();
    }
  }

  /** Ends the current utterance and waits (bounded) for the server to close it, so a
   * Stop or Pause pressed mid-utterance still gets its final before capture tears down.
   * The server sends the utterance's final before acknowledging the end. */
  async flush(): Promise<void> {
    if (!this.session) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        this.awaitingFinal = null;
        resolve();
      };
      this.awaitingFinal = settle;
      if (!this.awaitingAck) this.endUtterance();
      setTimeout(settle, FLUSH_TIMEOUT_MS);
    });
  }

  /** The chunk-length setting caps how long one utterance may run before it is sent. */
  setOptions(options: Partial<StreamingOptions>): void {
    if (options.maxUtteranceMs !== undefined) this.maxUtteranceMs = options.maxUtteranceMs;
  }

  private endUtterance(): void {
    this.session?.sendRealtimeInput({ activityEnd: {} });
    this.awaitingAck = true;
    this.utteranceSamples = 0;
    this.ackTimer = setTimeout(() => this.onUtteranceClosed(), ACK_TIMEOUT_MS);
  }

  /** Server acknowledged the activityEnd (or the acknowledgement timed out): open the next utterance. */
  private onUtteranceClosed(): void {
    if (!this.awaitingAck) return;
    this.awaitingAck = false;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    this.session?.sendRealtimeInput({ activityStart: {} });
    this.awaitingFinal?.();
  }

  private handleMessage(message: { serverContent?: LiveServerContentLike; voiceActivity?: "ACTIVITY_START" | "ACTIVITY_END" }): void {
    const content = message.serverContent;
    const interimText = content?.interimInputTranscription?.text;
    if (interimText) {
      const event = this.stabilizer.onHypothesis(interimText, Date.now());
      if (event) this.onEvent(event);
    }

    const finalText = content?.inputTranscription?.text;
    if (finalText) {
      const event = this.stabilizer.onFinal(finalText, Date.now());
      if (event) this.onEvent(event);
    }

    if (message.voiceActivity === "ACTIVITY_END") this.onUtteranceClosed();
  }

  private fail(message: string): void {
    this.closeSession();
    this.status = { state: "error", message };
    this.onEvent({ type: "error", code: "transcription-failed", message });
  }

  private closeSession(): void {
    this.connectionId++; // callbacks from the closed session, including its onclose, are now stale
    this.session?.close();
    this.session = null;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    this.awaitingAck = false;
    this.awaitingFinal?.();
  }

  private resetUtteranceState(): void {
    this.stabilizer.reset();
    this.vad.reset();
    this.utteranceSamples = 0;
    this.totalSamples = 0;
  }
}

/** The SDK's types name this field `voiceActivityType`, but v2.24.0 delivers the wire
 * name `type` at runtime (observed against the real API, 2026-09-23); accept either. */
const voiceActivityTypeOf = (activity: VoiceActivity | undefined): string | undefined => {
  if (!activity) return undefined;
  if (activity.voiceActivityType) return activity.voiceActivityType;
  return "type" in activity && typeof activity.type === "string" ? activity.type : undefined;
};

/**
 * Production `connect` for GeminiLiveEngineConfig, using the real @google/genai
 * browser SDK (see HANDOFF.md "Gemini Live" for why this SDK and not a hand-rolled
 * WebSocket client — its shipped types are the source of truth this file is written
 * against). `inputAudioTranscription: {}` requests transcription of the audio *we*
 * send with default settings (auto language detection, VERBATIM mode) — this engine
 * only cares about transcribing input, never about a spoken model reply, so
 * `responseModalities` (which controls the model's own audio/text reply) is
 * deliberately left unset. `realtimeInputConfig` hands utterance boundaries to the
 * client — see the file header for why.
 */
export const createGeminiLiveConnect = (): GeminiLiveEngineConfig["connect"] => async (apiKey, callbacks) => {
  const client = new GoogleGenAI({ apiKey });
  return client.live.connect({
    model: LIVE_TRANSCRIBE_MODEL,
    config: {
      inputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: true },
        turnCoverage: TurnCoverage.TURN_INCLUDES_ALL_INPUT,
      },
    },
    callbacks: {
      onmessage: (message: LiveServerMessage) => {
        const activity = voiceActivityTypeOf(message.voiceActivity);
        callbacks.onmessage({
          serverContent: message.serverContent,
          voiceActivity: activity === "ACTIVITY_START" || activity === "ACTIVITY_END" ? activity : undefined,
        });
      },
      onerror: (event) => callbacks.onerror?.({ message: event.message }),
      onclose: (event) => callbacks.onclose?.({ reason: event.reason }),
    },
  });
};

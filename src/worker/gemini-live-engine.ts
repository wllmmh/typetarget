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
 *
 * Connections don't last: the free tier ends each one after ~10 minutes, and networks
 * drop. The engine stays "ready" across a lost connection and reconnects by itself —
 * with backoff, up to MAX_CONSECUTIVE_FAILURES — holding the audio the server never
 * finished with (the open utterance, plus one ended but not yet acknowledged) and
 * replaying it on the new connection, so a reconnect loses no speech. Before the time
 * limit is reached (or when the server warns with `goAway`) it replaces the connection at
 * the next utterance boundary instead of waiting to be cut off mid-sentence. Only errors
 * no retry can fix (a bad key, a refused request) stop it.
 */
import { GoogleGenAI, TurnCoverage, type LiveServerMessage, type VoiceActivity } from "@google/genai";
import type { ConnectionStatus, EngineStatus, ModelId, TranscriptionEngine, TranscriptionOptions, TranscriptionResult } from "../domain/models";
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

export type LiveServerMessageLike = {
  serverContent?: LiveServerContentLike;
  voiceActivity?: "ACTIVITY_START" | "ACTIVITY_END";
  /** The server will end this connection soon (the SDK's LiveServerGoAway). */
  goAway?: { timeLeft?: string };
};

export type LiveSessionCallbacks = {
  onmessage: (message: LiveServerMessageLike) => void;
  onerror?: (event: { message?: string }) => void;
  onclose?: (event: { reason?: string; code?: number }) => void;
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
  /** Told of every connection opened and every reconnect attempt, for the listening timer. */
  onConnectionStatus?: (status: ConnectionStatus) => void;
};

/** Bound on how long flush() waits for the server to close the last utterance, so "Stop"
 * can't hang forever on a network hiccup or server-side timeout. */
const FLUSH_TIMEOUT_MS = 5_000;
/** If the server never acknowledges an activityEnd, reopen anyway rather than stop
 * transcribing for the rest of the session. The observed acknowledgement takes ~0.3-0.6 s. */
const ACK_TIMEOUT_MS = 3_000;
/** This many acknowledgements missed in a row means the connection has stalled: reconnect. */
const MAX_ACK_TIMEOUTS = 2;
const SAMPLE_RATE = 16_000;
/** A connect that neither opens nor fails in this long is treated as failed. */
const CONNECT_TIMEOUT_MS = 15_000;
/** The free tier ends a connection at ~10 minutes; replace it at the first utterance
 * boundary after this. The chunk-length cap (25 s at most) guarantees one comes in time. */
const ROTATE_AFTER_MS = 9 * 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** Failed connects — or connections lost soon after opening, before the server answered
 * anything — in a row before giving up. With the backoff above, about a minute and a half. */
export const MAX_CONSECUTIVE_FAILURES = 8;
/** A connection that stayed open this long worked, even if nothing was said for the server to answer. */
const STABLE_CONNECTION_MS = 30_000;
/** A connection lost this long after the last audio (stopped or paused) isn't reopened
 * until audio arrives again, rather than holding an idle connection open indefinitely. */
const IDLE_MS = 30_000;
/** Most audio held for replay across a reconnect; the oldest is dropped past this. */
const MAX_BUFFERED_SAMPLES = 60 * SAMPLE_RATE;

const NO_API_KEY_MESSAGE = "Set a Gemini API key first (see the popup's API Keys dialog).";

/**
 * Failures a reconnect can't fix. Matched on text because that is all the server gives:
 * a close reason, an error message. Anything else — timeouts, the time limit, rate or
 * quota limits, server errors, network loss — is retried; a misjudged permanent error
 * costs only the bounded retries above.
 */
const PERMANENT_FAILURE = /api[ _-]?key|permission|unauthori[sz]ed|unauthenticated|forbidden|billing|not found|not supported|invalid argument/i;

export const isRetryableConnectionError = (reason: string): boolean => !PERMANENT_FAILURE.test(reason);

/** Delay before the attempt following `failures` consecutive failures: 1 s, 2 s, 4 s, … capped at 30 s. */
export const reconnectBackoffMs = (failures: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const messageOf = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

const sumSamples = (chunks: Float32Array[]): number => chunks.reduce((sum, chunk) => sum + chunk.length, 0);

const audioInput = (samples: Float32Array) => ({ audio: { data: float32ToPcm16Base64(samples), mimeType: "audio/pcm;rate=16000" } });

export class GeminiLiveEngine implements TranscriptionEngine {
  private status: EngineStatus = { state: "unloaded" };
  private session: LiveSessionLike | null = null;
  private readonly stabilizer = new TranscriptStabilizer();
  private readonly vad: VoiceActivityDetector;
  private awaitingFinal: (() => void) | null = null;
  private maxUtteranceMs = CHUNK_MS_DEFAULT;
  /** Audio of the open utterance — sent, or, while disconnected, waiting to be. Kept until
   * the utterance ends so a lost connection can replay it. */
  private current: Float32Array[] = [];
  /** Audio of the utterance ended but not yet acknowledged, whose final may never come. */
  private closing: Float32Array[] = [];
  /** Samples in `current`; compared against maxUtteranceMs. */
  private utteranceSamples = 0;
  private totalSamples = 0;
  /** activityEnd sent, the server's ACTIVITY_END not yet seen; no new activityStart until it is. */
  private awaitingAck = false;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimeouts = 0;
  /** Bumped per connect and per dropped connection, so callbacks from an old session are ignored. */
  private connectionId = 0;
  /** Bumped by load() and unload(), so a reconnect loop from before either gives up. */
  private lifecycle = 0;
  private reconnecting = false;
  private failureStreak = 0;
  /** The current connection has answered something, i.e. it is known to work. */
  private provenAlive = false;
  private connectedAt = 0;
  private hasConnected = false;
  private reconnects = 0;
  private rotateDue = false;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAudioAt = 0;

  constructor(
    private readonly config: GeminiLiveEngineConfig,
    private readonly onEvent: (event: TranscriptEvent) => void,
  ) {
    this.vad = config.vad ?? new EnergyVad();
  }

  /** Resolves once connected — retrying transient failures first, still "loading" meanwhile. */
  async load(modelId: ModelId): Promise<void> {
    if (!this.config.getApiKey()) {
      this.status = { state: "error", message: NO_API_KEY_MESSAGE };
      throw new Error(this.status.message);
    }

    const lifecycle = ++this.lifecycle;
    this.dropSession(); // Stop/Start loads again; don't leave the previous socket open
    this.clearAudio();
    this.resetUtteranceState();
    this.reconnecting = false;
    this.failureStreak = 0;
    this.hasConnected = false;
    this.reconnects = 0;
    this.lastAudioAt = 0;
    this.status = { state: "loading", modelId };
    try {
      await this.openWithRetry(lifecycle);
      this.status = { state: "ready", modelId };
    } catch (err) {
      if (lifecycle === this.lifecycle) this.status = { state: "error", message: messageOf(err, "Failed to connect to Gemini.") };
      throw err;
    }
  }

  async unload(): Promise<void> {
    this.lifecycle++;
    this.dropSession();
    this.clearAudio();
    this.reconnecting = false;
    this.status = { state: "unloaded" };
  }

  /** Unreachable via the normal pipeline — see file header. Implemented rather than
   * left absent so the TranscriptionEngine contract holds if that ever changes. */
  async transcribe(_audio: Float32Array, _options?: TranscriptionOptions): Promise<TranscriptionResult> {
    throw new Error("GeminiLiveEngine.transcribe() is not used; audio is streamed via pushAudio().");
  }

  /**
   * Closes the session so nothing from before the reset can surface afterwards — the same
   * intent as StreamingTranscriber's generation counter (HANDOFF.md: "audio from the last
   * session was transcribed and typed into the next one"), just via connection lifecycle
   * instead of a counter, since there is no local queue here to invalidate.
   *
   * Deliberately does not reconnect: Stop resets, and Stop must cut the connection. Every
   * caller that wants one again (Start, a model load) follows the reset with load(). A
   * pending load or reconnect is abandoned too (`lifecycle`), so it can't reopen one.
   */
  async reset(): Promise<void> {
    this.lifecycle++;
    this.dropSession();
    this.clearAudio();
    this.resetUtteranceState();
    this.reconnecting = false;
    // Nothing is connected now, and "ready" would have the next audio reopen a connection by
    // itself (pushAudio's idle-disconnect path) instead of waiting for the load that follows.
    if (this.status.state === "ready" || this.status.state === "loading") this.status = { state: "unloaded" };
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  /** Streams one batch of 16 kHz mono PCM over the open session, and ends the utterance at
   * a pause or at the chunk-length cap. While reconnecting — or after an idle disconnect,
   * which this reopens — the audio is held and replayed once connected. Dropped silently
   * if not loaded, matching how the controller already drops audio pushed before an
   * engine reports "ready" (see asr-worker-controller.ts). */
  pushAudio(samples: Float32Array): void {
    if (this.status.state !== "ready") return;
    this.lastAudioAt = Date.now();
    this.current.push(samples);
    this.utteranceSamples += samples.length;
    this.totalSamples += samples.length;
    this.trimBuffer();
    const vadEvent = this.vad.processFrame(samples, (this.totalSamples / SAMPLE_RATE) * 1000);
    if (!this.session) {
      if (!this.reconnecting) this.reconnect("Reconnecting to Gemini after an idle disconnect.");
      return;
    }
    this.session.sendRealtimeInput(audioInput(samples));
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
    this.closing = this.current;
    this.current = [];
    this.utteranceSamples = 0;
    this.ackTimer = setTimeout(() => this.onUtteranceClosed(true), ACK_TIMEOUT_MS);
  }

  /** Server acknowledged the activityEnd (or the acknowledgement timed out): open the next
   * utterance — on a fresh connection if this one is due for replacement. */
  private onUtteranceClosed(timedOut: boolean): void {
    if (!this.awaitingAck) return;
    if (timedOut && ++this.ackTimeouts >= MAX_ACK_TIMEOUTS) {
      this.onConnectionLost("Gemini stopped responding.");
      return;
    }
    if (!timedOut) this.ackTimeouts = 0;
    this.awaitingAck = false;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    this.closing = []; // its final, if it had one, arrived before the acknowledgement
    this.awaitingFinal?.();
    if (this.rotateDue) {
      this.dropSession();
      this.reconnect("Refreshing the connection before Gemini's time limit.");
      return;
    }
    this.session?.sendRealtimeInput({ activityStart: {} });
  }

  private handleMessage(message: LiveServerMessageLike): void {
    const content = message.serverContent;
    const interimText = content?.interimInputTranscription?.text;
    const finalText = content?.inputTranscription?.text;
    if (interimText || finalText || message.voiceActivity === "ACTIVITY_END") {
      this.provenAlive = true;
      this.failureStreak = 0;
    }
    if (message.goAway) this.rotateDue = true;

    if (interimText) {
      const event = this.stabilizer.onHypothesis(interimText, Date.now());
      if (event) this.onEvent(event);
    }

    if (finalText) {
      const event = this.stabilizer.onFinal(finalText, Date.now());
      if (event) this.onEvent(event);
    }

    if (message.voiceActivity === "ACTIVITY_END") this.onUtteranceClosed(false);
  }

  /** Opens a connection, retrying with backoff; throws once retrying is pointless or exhausted. */
  private async openWithRetry(lifecycle: number): Promise<void> {
    for (;;) {
      try {
        await this.openSession(lifecycle);
        return;
      } catch (err) {
        if (lifecycle !== this.lifecycle) throw err;
        const reason = messageOf(err, "Failed to connect to Gemini.");
        this.failureStreak++;
        if (!isRetryableConnectionError(reason) || this.failureStreak >= MAX_CONSECUTIVE_FAILURES) throw err;
        this.reportConnection({ state: "reconnecting", attempt: this.failureStreak + 1, reason });
        await wait(reconnectBackoffMs(this.failureStreak));
        if (lifecycle !== this.lifecycle) throw new Error("Superseded by a newer load.");
      }
    }
  }

  private async openSession(lifecycle: number): Promise<void> {
    const apiKey = this.config.getApiKey();
    if (!apiKey) throw new Error(NO_API_KEY_MESSAGE);

    const connection = ++this.connectionId;
    // Only the connection currently in use may act: not one that is still opening, nor one replaced since.
    const isCurrent = () => connection === this.connectionId && this.session !== null;
    const opening = this.config.connect(apiKey, {
      onmessage: (message) => {
        if (isCurrent()) this.handleMessage(message);
      },
      onerror: (event) => {
        if (isCurrent()) this.onConnectionLost(event.message ?? "Gemini connection error.");
      },
      onclose: (event) => {
        if (!isCurrent()) return;
        const code = event.code === undefined ? "" : ` (code ${event.code})`;
        this.onConnectionLost(`Gemini closed the connection${code}${event.reason ? `: ${event.reason}` : "."}`);
      },
    });
    const session = await new Promise<LiveSessionLike>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        this.connectionId++;
        reject(new Error("Timed out connecting to Gemini."));
      }, CONNECT_TIMEOUT_MS);
      opening.then(
        (opened) => {
          clearTimeout(timer);
          if (timedOut) opened.close();
          else resolve(opened);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
    if (connection !== this.connectionId || lifecycle !== this.lifecycle) {
      session.close();
      throw new Error("Superseded by a newer connection.");
    }

    this.session = session;
    this.provenAlive = false;
    this.connectedAt = Date.now();
    this.ackTimeouts = 0;
    session.sendRealtimeInput({ activityStart: {} });
    // Whatever the last connection never finished with — see dropSession().
    for (const samples of this.current) session.sendRealtimeInput(audioInput(samples));
    if (this.hasConnected) this.reconnects++;
    this.hasConnected = true;
    this.rotateTimer = setTimeout(() => (this.rotateDue = true), ROTATE_AFTER_MS);
    this.reportConnection({ state: "connected", since: this.connectedAt, reconnects: this.reconnects });
  }

  /** The connection closed or failed without being asked to: reconnect, unless retrying can't help. */
  private onConnectionLost(reason: string): void {
    const worked = this.provenAlive || Date.now() - this.connectedAt >= STABLE_CONNECTION_MS;
    this.failureStreak = worked ? 0 : this.failureStreak + 1;
    this.dropSession();
    if (!isRetryableConnectionError(reason) || this.failureStreak >= MAX_CONSECUTIVE_FAILURES) {
      this.fail(reason);
      return;
    }
    if (Date.now() - this.lastAudioAt >= IDLE_MS) return; // reopened by the next pushAudio()
    this.reconnect(reason);
  }

  private reconnect(reason: string): void {
    this.reconnecting = true;
    this.reportConnection({ state: "reconnecting", attempt: this.failureStreak + 1, reason });
    const lifecycle = this.lifecycle;
    void (async () => {
      try {
        if (this.failureStreak > 0) {
          await wait(reconnectBackoffMs(this.failureStreak));
          if (lifecycle !== this.lifecycle) return;
        }
        await this.openWithRetry(lifecycle);
      } catch (err) {
        if (lifecycle === this.lifecycle) this.fail(messageOf(err, "Could not reconnect to Gemini."));
      } finally {
        if (lifecycle === this.lifecycle) this.reconnecting = false;
      }
    })();
  }

  private fail(message: string): void {
    this.dropSession();
    this.clearAudio();
    this.reconnecting = false;
    this.status = { state: "error", message };
    this.onEvent({ type: "error", code: "transcription-failed", message });
  }

  /**
   * Closes the current connection, if any. Audio of an utterance the server hadn't
   * acknowledged yet moves back into `current`, ahead of what followed it, so a
   * reconnect replays both as one utterance.
   */
  private dropSession(): void {
    this.connectionId++; // callbacks from the closed session, including its onclose, are now stale
    this.session?.close();
    this.session = null;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    this.rotateTimer = null;
    this.rotateDue = false;
    if (this.awaitingAck) {
      this.current = [...this.closing, ...this.current];
      this.utteranceSamples = sumSamples(this.current);
      this.trimBuffer();
    }
    this.closing = [];
    this.awaitingAck = false;
    this.awaitingFinal?.();
  }

  private trimBuffer(): void {
    while (this.utteranceSamples > MAX_BUFFERED_SAMPLES && this.current.length > 1) {
      this.utteranceSamples -= this.current.shift()?.length ?? 0;
    }
  }

  private clearAudio(): void {
    this.current = [];
    this.closing = [];
    this.utteranceSamples = 0;
  }

  private reportConnection(status: ConnectionStatus): void {
    this.config.onConnectionStatus?.(status);
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
          goAway: message.goAway,
        });
      },
      onerror: (event) => callbacks.onerror?.({ message: event.message }),
      onclose: (event) => callbacks.onclose?.({ reason: event.reason, code: event.code }),
    },
  });
};

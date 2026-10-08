import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "../domain/transcript";
import type { VadEvent, VoiceActivityDetector } from "../domain/vad";
import type { ConnectionStatus } from "../domain/models";
import {
  GeminiLiveEngine,
  isRetryableConnectionError,
  MAX_CONSECUTIVE_FAILURES,
  reconnectBackoffMs,
  type GeminiLiveEngineConfig,
  type LiveServerContentLike,
  type LiveSessionCallbacks,
  type LiveSessionLike,
} from "./gemini-live-engine";

/** Fake @google/genai Session: records what was sent, and lets tests push server
 * messages back through whatever callbacks connect() was given, the same DI shape
 * whisper-cpp-engine.test.ts uses for its fake module factory. */
const createFakeConnect = () => {
  const sessions: { sendRealtimeInput: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  let latestCallbacks: LiveSessionCallbacks | null = null;
  /** Errors the next connect() calls reject with, in order, before connecting normally again. */
  const failures: Error[] = [];
  const connect: GeminiLiveEngineConfig["connect"] = vi.fn(async (_apiKey, callbacks) => {
    const failure = failures.shift();
    if (failure) throw failure;
    latestCallbacks = callbacks;
    const session: LiveSessionLike = { sendRealtimeInput: vi.fn(), close: vi.fn() };
    sessions.push(session as unknown as (typeof sessions)[number]);
    return session;
  });
  const emit = (serverContent: LiveServerContentLike) => latestCallbacks?.onmessage({ serverContent });
  /** The server's acknowledgement that an utterance the client ended is closed. */
  const emitActivityEnd = () => latestCallbacks?.onmessage({ voiceActivity: "ACTIVITY_END" });
  return { connect, sessions, failures, emit, emitActivityEnd, getLatestCallbacks: () => latestCallbacks };
};

/** A VAD that stays silent unless a test queues an event for the next frame. */
const createFakeVad = () => {
  let next: VadEvent | null = null;
  const vad: VoiceActivityDetector = {
    processFrame: () => {
      const event = next;
      next = null;
      return event;
    },
    getState: () => "silence",
    reset: () => {},
  };
  return { vad, queue: (event: VadEvent) => (next = event) };
};

const createEngine = (
  apiKey: string | null,
  events: TranscriptEvent[],
  connect: GeminiLiveEngineConfig["connect"],
  vad: VoiceActivityDetector = createFakeVad().vad,
  onConnectionStatus?: (status: ConnectionStatus) => void,
) => new GeminiLiveEngine({ connect, getApiKey: () => apiKey, vad, onConnectionStatus }, (event) => events.push(event));

/** How many batches of audio a session was sent. */
const audioSent = (session: { sendRealtimeInput: ReturnType<typeof vi.fn> } | undefined) =>
  (session?.sendRealtimeInput.mock.calls ?? []).filter(([input]: unknown[]) => typeof input === "object" && input !== null && "audio" in input).length;

/** Only the turn-control messages sent on a session, in order ("start" / "end"). */
const turnSignals = (session: { sendRealtimeInput: ReturnType<typeof vi.fn> } | undefined) =>
  (session?.sendRealtimeInput.mock.calls ?? []).flatMap(([input]: unknown[]) => {
    if (typeof input !== "object" || input === null) return [];
    return "activityStart" in input ? ["start"] : "activityEnd" in input ? ["end"] : [];
  });

/** One second of 16 kHz audio. */
const oneSecond = () => new Float32Array(16_000);

afterEach(() => {
  vi.useRealTimers();
});

describe("GeminiLiveEngine.load", () => {
  it("reports an error and rejects when no API key is set", async () => {
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine(null, events, connect);

    await expect(engine.load("gemini-3.5-transcribe-live")).rejects.toThrow(/API key/);
    expect(engine.getStatus()).toEqual({ state: "error", message: expect.stringContaining("API key") });
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects and reports ready", async () => {
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);

    await engine.load("gemini-3.5-transcribe-live");

    expect(connect).toHaveBeenCalledWith("test-key", expect.anything());
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "gemini-3.5-transcribe-live" });
  });

  it("opens the first utterance right after connecting", async () => {
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);

    await engine.load("gemini-3.5-transcribe-live");

    expect(turnSignals(sessions[0])).toEqual(["start"]);
  });

  it("closes the previous session when loaded again", async () => {
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");

    await engine.load("gemini-3.5-transcribe-live");

    expect(sessions[0]?.close).toHaveBeenCalled();
    expect(sessions[1]?.close).not.toHaveBeenCalled();
  });

  it("retries a failed connect with backoff, then reports ready", async () => {
    vi.useFakeTimers();
    const statuses: ConnectionStatus[] = [];
    const { connect, failures } = createFakeConnect();
    failures.push(new Error("network unreachable"), new Error("network unreachable"));
    const engine = createEngine("test-key", [], connect, undefined, (status) => statuses.push(status));

    const loading = engine.load("gemini-3.5-transcribe-live");
    expect(engine.getStatus()).toEqual({ state: "loading", modelId: "gemini-3.5-transcribe-live" });
    await vi.advanceTimersByTimeAsync(reconnectBackoffMs(1) + reconnectBackoffMs(2));
    await loading;

    expect(connect).toHaveBeenCalledTimes(3);
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "gemini-3.5-transcribe-live" });
    expect(statuses).toEqual([
      { state: "reconnecting", attempt: 2, reason: "network unreachable" },
      { state: "reconnecting", attempt: 3, reason: "network unreachable" },
      { state: "connected", since: expect.any(Number), reconnects: 0 },
    ]);
  });

  it("gives up and reports an error once the connect keeps failing", async () => {
    vi.useFakeTimers();
    const connect: GeminiLiveEngineConfig["connect"] = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const engine = createEngine("test-key", [], connect);

    const assertion = expect(engine.load("gemini-3.5-transcribe-live")).rejects.toThrow("network unreachable");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await assertion;

    expect(connect).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
    expect(engine.getStatus()).toEqual({ state: "error", message: "network unreachable" });
  });

  it("does not retry a connect refused for a reason retrying can't fix", async () => {
    const { connect, failures } = createFakeConnect();
    failures.push(new Error("API key not valid. Please pass a valid API key."));
    const engine = createEngine("test-key", [], connect);

    await expect(engine.load("gemini-3.5-transcribe-live")).rejects.toThrow(/API key not valid/);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toEqual({ state: "error", message: expect.stringContaining("API key not valid") });
  });

  it("retries a connect that never opens", async () => {
    vi.useFakeTimers();
    const { connect: connectNormally } = createFakeConnect();
    const connect = vi.fn<GeminiLiveEngineConfig["connect"]>().mockImplementationOnce(() => new Promise(() => {}));
    connect.mockImplementation(connectNormally);
    const engine = createEngine("test-key", [], connect);

    const loading = engine.load("gemini-3.5-transcribe-live");
    await vi.advanceTimersByTimeAsync(15_000 + reconnectBackoffMs(1));
    await loading;

    expect(connect).toHaveBeenCalledTimes(2);
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "gemini-3.5-transcribe-live" });
  });
});

describe("GeminiLiveEngine streaming", () => {
  it("PCM16-encodes pushed audio and sends it over the session", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    engine.pushAudio(new Float32Array([0, 1, -1]));

    expect(sessions[0]?.sendRealtimeInput).toHaveBeenCalledWith({
      audio: { data: expect.any(String), mimeType: "audio/pcm;rate=16000" },
    });
  });

  it("drops pushAudio silently when not connected", async () => {
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);

    expect(() => engine.pushAudio(new Float32Array(4))).not.toThrow();
  });

  it("emits a partial event for interimInputTranscription", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, emit } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    emit({ interimInputTranscription: { text: "hello wor" } });

    expect(events).toEqual([{ type: "partial", text: "hello wor", timestamp: expect.any(Number) }]);
  });

  it("emits a final event for inputTranscription on its own", async () => {
    // The real server sends the utterance's final as a bare inputTranscription and never
    // sends turnComplete; waiting for turnComplete meant no final was ever emitted.
    const events: TranscriptEvent[] = [];
    const { connect, emit } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    emit({ interimInputTranscription: { text: "hello wor" } });
    emit({ inputTranscription: { text: "hello world" } });

    expect(events).toEqual([
      { type: "partial", text: "hello wor", timestamp: expect.any(Number) },
      { type: "final", text: "hello world", timestamp: expect.any(Number) },
    ]);
  });
});

describe("GeminiLiveEngine utterance boundaries", () => {
  it("ends the utterance at the chunk-length cap and reopens only once the server acknowledges", async () => {
    const { connect, sessions, emitActivityEnd } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.setOptions({ maxUtteranceMs: 3_000 });

    engine.pushAudio(oneSecond());
    engine.pushAudio(oneSecond());
    expect(turnSignals(sessions[0])).toEqual(["start"]);

    engine.pushAudio(oneSecond());
    expect(turnSignals(sessions[0])).toEqual(["start", "end"]);

    // An activityStart sent before the acknowledgement is dropped by the server, so none
    // goes out yet — but audio keeps streaming, and lands in the next utterance.
    engine.pushAudio(oneSecond());
    expect(turnSignals(sessions[0])).toEqual(["start", "end"]);
    expect(sessions[0]?.sendRealtimeInput).toHaveBeenLastCalledWith({ audio: expect.anything() });

    emitActivityEnd();
    expect(turnSignals(sessions[0])).toEqual(["start", "end", "start"]);
  });

  it("ends the utterance early at a pause in speech", async () => {
    const { connect, sessions } = createFakeConnect();
    const { vad, queue } = createFakeVad();
    const engine = createEngine("test-key", [], connect, vad);
    await engine.load("gemini-3.5-transcribe-live");

    queue({ type: "speech-end", timestamp: 1_000 });
    engine.pushAudio(oneSecond());

    expect(turnSignals(sessions[0])).toEqual(["start", "end"]);
  });

  it("reopens anyway if the server never acknowledges the end", async () => {
    vi.useFakeTimers();
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.setOptions({ maxUtteranceMs: 1_000 });

    engine.pushAudio(oneSecond());
    await vi.advanceTimersByTimeAsync(3_000);

    expect(turnSignals(sessions[0])).toEqual(["start", "end", "start"]);
  });
});

describe("GeminiLiveEngine connection loss", () => {
  it("reconnects by itself when the server closes the session mid-stream, replaying the unfinished utterance", async () => {
    const events: TranscriptEvent[] = [];
    const statuses: ConnectionStatus[] = [];
    const { connect, sessions, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", events, connect, undefined, (status) => statuses.push(status));
    await engine.load("gemini-3.5-transcribe-live");
    engine.pushAudio(oneSecond());
    engine.pushAudio(oneSecond());
    getLatestCallbacks()?.onmessage({ serverContent: { interimInputTranscription: { text: "hello" } } });

    getLatestCallbacks()?.onclose?.({ code: 1011, reason: "quota exceeded" });
    // Audio arriving while it reconnects is held, not dropped.
    engine.pushAudio(oneSecond());
    await vi.waitFor(() => expect(turnSignals(sessions[1])).toEqual(["start"]));

    expect(sessions[0]?.close).toHaveBeenCalled();
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "gemini-3.5-transcribe-live" });
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(turnSignals(sessions[1])).toEqual(["start"]);
    expect(audioSent(sessions[1])).toBe(3);
    expect(statuses.slice(1)).toEqual([
      { state: "reconnecting", attempt: 1, reason: "Gemini closed the connection (code 1011): quota exceeded" },
      { state: "connected", since: expect.any(Number), reconnects: 1 },
    ]);
  });

  it("also replays an utterance that was ended but never acknowledged", async () => {
    const { connect, sessions, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.setOptions({ maxUtteranceMs: 2_000 });
    engine.pushAudio(oneSecond());
    engine.pushAudio(oneSecond()); // ends the utterance
    engine.pushAudio(oneSecond()); // start of the next one

    getLatestCallbacks()?.onerror?.({ message: "socket reset" });
    // The server never answered on that connection, so the reconnect backs off a step first.
    await vi.waitFor(() => expect(turnSignals(sessions[1])).toEqual(["start"]), { timeout: reconnectBackoffMs(1) + 1_000 });

    expect(audioSent(sessions[1])).toBe(3);
  });

  it("does not replay an utterance the server already finished", async () => {
    const { connect, sessions, emitActivityEnd, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.setOptions({ maxUtteranceMs: 2_000 });
    engine.pushAudio(oneSecond());
    engine.pushAudio(oneSecond());
    emitActivityEnd();
    engine.pushAudio(oneSecond());

    getLatestCallbacks()?.onclose?.({});
    await vi.waitFor(() => expect(turnSignals(sessions[1])).toEqual(["start"]));

    expect(audioSent(sessions[1])).toBe(1);
  });

  it("fails instead of reconnecting when the server refuses for a reason retrying can't fix", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, sessions, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.pushAudio(oneSecond());

    getLatestCallbacks()?.onclose?.({ code: 1008, reason: "API key not valid" });

    expect(engine.getStatus()).toEqual({ state: "error", message: expect.stringContaining("API key not valid") });
    expect(events).toEqual([{ type: "error", code: "transcription-failed", message: expect.stringContaining("API key not valid") }]);
    engine.pushAudio(oneSecond());
    expect(sessions).toHaveLength(1);
  });

  it("gives up after repeated connections that die before the server answers anything", async () => {
    vi.useFakeTimers();
    const events: TranscriptEvent[] = [];
    const { connect, sessions, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      engine.pushAudio(oneSecond());
      getLatestCallbacks()?.onclose?.({ reason: "internal error" });
      await vi.advanceTimersByTimeAsync(reconnectBackoffMs(i + 1));
    }

    expect(sessions).toHaveLength(MAX_CONSECUTIVE_FAILURES);
    expect(engine.getStatus()).toEqual({ state: "error", message: expect.stringContaining("internal error") });
  });

  it("leaves a connection lost while idle closed until audio arrives again", async () => {
    vi.useFakeTimers();
    const { connect, sessions, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.pushAudio(oneSecond());
    await vi.advanceTimersByTimeAsync(60_000);

    getLatestCallbacks()?.onclose?.({ reason: "idle timeout" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sessions).toHaveLength(1);

    engine.pushAudio(oneSecond());
    await vi.advanceTimersByTimeAsync(0);
    expect(sessions).toHaveLength(2);
    expect(audioSent(sessions[1])).toBeGreaterThan(0);
  });

  it("reconnects when the server stops acknowledging utterances", async () => {
    vi.useFakeTimers();
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.setOptions({ maxUtteranceMs: 1_000 });

    engine.pushAudio(oneSecond());
    await vi.advanceTimersByTimeAsync(3_000); // first missed acknowledgement: carry on
    expect(sessions).toHaveLength(1);
    engine.pushAudio(oneSecond());
    await vi.advanceTimersByTimeAsync(3_000); // second in a row: stalled
    await vi.advanceTimersByTimeAsync(reconnectBackoffMs(1)); // it never answered, so back off a step

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.close).toHaveBeenCalled();
  });

  it("isRetryableConnectionError retries transient failures only", () => {
    expect(isRetryableConnectionError("Gemini closed the connection (code 1011): Internal error")).toBe(true);
    expect(isRetryableConnectionError("RESOURCE_EXHAUSTED: quota exceeded")).toBe(true);
    expect(isRetryableConnectionError("Timed out connecting to Gemini.")).toBe(true);
    expect(isRetryableConnectionError("API key not valid")).toBe(false);
    expect(isRetryableConnectionError("PERMISSION_DENIED")).toBe(false);
  });

  it("does not report the close it caused itself", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");
    const callbacks = getLatestCallbacks();

    await engine.unload();
    callbacks?.onclose?.({});

    expect(events).toEqual([]);
    expect(engine.getStatus()).toEqual({ state: "unloaded" });
  });
});

describe("GeminiLiveEngine connection renewal", () => {
  it("replaces the connection at the next utterance boundary once the server warns it will end it", async () => {
    const statuses: ConnectionStatus[] = [];
    const { connect, sessions, emitActivityEnd, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", [], connect, undefined, (status) => statuses.push(status));
    await engine.load("gemini-3.5-transcribe-live");
    engine.setOptions({ maxUtteranceMs: 2_000 });

    getLatestCallbacks()?.onmessage({ goAway: { timeLeft: "50s" } });
    engine.pushAudio(oneSecond());
    expect(sessions).toHaveLength(1); // not mid-utterance
    engine.pushAudio(oneSecond()); // ends the utterance
    engine.pushAudio(oneSecond());
    emitActivityEnd();
    await vi.waitFor(() => expect(turnSignals(sessions[1])).toEqual(["start"]));

    // The old connection gets no new utterance; the new one gets the audio sent after the boundary.
    expect(turnSignals(sessions[0])).toEqual(["start", "end"]);
    expect(sessions[0]?.close).toHaveBeenCalled();
    expect(turnSignals(sessions[1])).toEqual(["start"]);
    expect(audioSent(sessions[1])).toBe(1);
    expect(statuses.at(-1)).toEqual({ state: "connected", since: expect.any(Number), reconnects: 1 });
  });

  it("replaces a connection nearing the free tier's 10-minute limit without being warned", async () => {
    vi.useFakeTimers();
    const { connect, sessions, emitActivityEnd } = createFakeConnect();
    const engine = createEngine("test-key", [], connect);
    await engine.load("gemini-3.5-transcribe-live");
    engine.setOptions({ maxUtteranceMs: 1_000 });

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    engine.pushAudio(oneSecond());
    emitActivityEnd();
    await vi.advanceTimersByTimeAsync(0);

    expect(sessions).toHaveLength(2);
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "gemini-3.5-transcribe-live" });
  });
});

describe("GeminiLiveEngine.flush", () => {
  it("ends the utterance and resolves once the server has closed it, after its final", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, sessions, emit, emitActivityEnd } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    const flushPromise = engine.flush();
    expect(turnSignals(sessions[0])).toEqual(["start", "end"]);

    emit({ inputTranscription: { text: "last words" } });
    emitActivityEnd();
    await expect(flushPromise).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "final", text: "last words", timestamp: expect.any(Number) }]);
  });

  it("resolves on its own after the timeout if no final arrives", async () => {
    vi.useFakeTimers();
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    const flushPromise = engine.flush();
    const assertion = expect(flushPromise).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it("resolves immediately when nothing is connected", async () => {
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await expect(engine.flush()).resolves.toBeUndefined();
  });
});

describe("GeminiLiveEngine.reset", () => {
  it("closes the current session without reconnecting", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    await engine.reset();

    expect(sessions[0]?.close).toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toEqual({ state: "unloaded" });
  });

  it("does not reopen a connection when audio arrives after a reset", async () => {
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");
    await engine.reset();

    engine.pushAudio(new Float32Array(1600));

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("drops a late message from the closed session, and the next load starts fresh", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, emit: emitOnLatest } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");
    await engine.reset();

    emitOnLatest({ inputTranscription: { text: "said before Stop" } });
    expect(events).toEqual([]);

    await engine.load("gemini-3.5-transcribe-live");
    // The stabilizer was reset too, so a stray interim from before a reset can't be
    // mistaken for a continuation of the new session's utterance.
    emitOnLatest({ interimInputTranscription: { text: "fresh start" } });
    expect(events).toEqual([{ type: "partial", text: "fresh start", timestamp: expect.any(Number) }]);
  });

  it("is a no-op when nothing was ever loaded", async () => {
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await expect(engine.reset()).resolves.toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("GeminiLiveEngine.unload", () => {
  it("closes the session and reports unloaded", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    await engine.unload();

    expect(sessions[0]?.close).toHaveBeenCalled();
    expect(engine.getStatus()).toEqual({ state: "unloaded" });
  });
});

describe("GeminiLiveEngine.transcribe", () => {
  it("throws, since audio is streamed via pushAudio() instead", async () => {
    const events: TranscriptEvent[] = [];
    const { connect } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await expect(engine.transcribe(new Float32Array(4))).rejects.toThrow(/pushAudio/);
  });
});

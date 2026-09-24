import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "../domain/transcript";
import type { VadEvent, VoiceActivityDetector } from "../domain/vad";
import { GeminiLiveEngine, type GeminiLiveEngineConfig, type LiveServerContentLike, type LiveSessionCallbacks, type LiveSessionLike } from "./gemini-live-engine";

/** Fake @google/genai Session: records what was sent, and lets tests push server
 * messages back through whatever callbacks connect() was given, the same DI shape
 * whisper-cpp-engine.test.ts uses for its fake module factory. */
const createFakeConnect = () => {
  const sessions: { sendRealtimeInput: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  let latestCallbacks: LiveSessionCallbacks | null = null;
  const connect: GeminiLiveEngineConfig["connect"] = vi.fn(async (_apiKey, callbacks) => {
    latestCallbacks = callbacks;
    const session: LiveSessionLike = { sendRealtimeInput: vi.fn(), close: vi.fn() };
    sessions.push(session as unknown as (typeof sessions)[number]);
    return session;
  });
  const emit = (serverContent: LiveServerContentLike) => latestCallbacks?.onmessage({ serverContent });
  /** The server's acknowledgement that an utterance the client ended is closed. */
  const emitActivityEnd = () => latestCallbacks?.onmessage({ voiceActivity: "ACTIVITY_END" });
  return { connect, sessions, emit, emitActivityEnd, getLatestCallbacks: () => latestCallbacks };
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
) => new GeminiLiveEngine({ connect, getApiKey: () => apiKey, vad }, (event) => events.push(event));

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

  it("reports an error status when the connection fails", async () => {
    const events: TranscriptEvent[] = [];
    const connect: GeminiLiveEngineConfig["connect"] = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const engine = createEngine("test-key", events, connect);

    await expect(engine.load("gemini-3.5-transcribe-live")).rejects.toThrow("network unreachable");
    expect(engine.getStatus()).toEqual({ state: "error", message: "network unreachable" });
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
  it("reports an error instead of silently dropping audio when the server closes the session", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, sessions, getLatestCallbacks } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    getLatestCallbacks()?.onclose?.({ reason: "quota exceeded" });

    expect(engine.getStatus()).toEqual({ state: "error", message: expect.stringContaining("quota exceeded") });
    expect(events).toEqual([{ type: "error", code: "transcription-failed", message: expect.stringContaining("quota exceeded") }]);
    engine.pushAudio(oneSecond());
    expect(sessions[0]?.sendRealtimeInput).not.toHaveBeenCalledWith({ audio: expect.anything() });
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
  it("closes the current session and reconnects a fresh one for the same model", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, sessions } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");

    await engine.reset();

    expect(sessions[0]?.close).toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "gemini-3.5-transcribe-live" });
  });

  it("drops a late message from the closed session after reset reconnects", async () => {
    const events: TranscriptEvent[] = [];
    const { connect, emit: emitOnLatest } = createFakeConnect();
    const engine = createEngine("test-key", events, connect);
    await engine.load("gemini-3.5-transcribe-live");
    await engine.reset();

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

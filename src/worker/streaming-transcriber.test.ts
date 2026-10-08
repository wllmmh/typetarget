import { describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "../domain/transcript";
import type { TranscriptionEngine, TranscriptionResult } from "../domain/models";
import { EnergyVad } from "./energy-vad";
import { TranscriptStabilizer } from "./stabilizer";
import { SAMPLE_RATE, StreamingTranscriber, type StreamingOptions } from "./streaming-transcriber";

const CHUNK_MS = 100;
const CHUNK_SAMPLES = (SAMPLE_RATE * CHUNK_MS) / 1000;
const loud = () => new Float32Array(CHUNK_SAMPLES).fill(0.5);
const quiet = () => new Float32Array(CHUNK_SAMPLES);

type Deferred = { audio: Float32Array; resolve: (text: string) => void; reject: (err: Error) => void };

/** Engine whose transcribe() calls stay pending until the test resolves them. */
const createManualEngine = () => {
  const calls: Deferred[] = [];
  const engine: TranscriptionEngine = {
    load: vi.fn(),
    unload: vi.fn(),
    reset: vi.fn(),
    getStatus: () => ({ state: "ready", modelId: "tiny.en" }),
    transcribe: vi.fn(
      (audio: Float32Array) =>
        new Promise<TranscriptionResult>((resolve, reject) => {
          calls.push({ audio, resolve: (text) => resolve({ text }), reject });
        }),
    ),
  };
  return { engine, calls };
};

/** Lets chained promise callbacks (the transcriber's serialized inference queue) run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup = (options?: Partial<StreamingOptions>) => {
  const { engine, calls } = createManualEngine();
  const events: TranscriptEvent[] = [];
  const transcriber = new StreamingTranscriber(
    { engine, vad: new EnergyVad(), stabilizer: new TranscriptStabilizer(), onEvent: (e) => events.push(e) },
    options,
  );
  const push = (kind: "loud" | "quiet", count: number) => {
    for (let i = 0; i < count; i++) transcriber.pushAudio(kind === "loud" ? loud() : quiet());
  };
  return { transcriber, engine, calls, events, push };
};

describe("StreamingTranscriber", () => {
  it("does nothing for silence", async () => {
    const { transcriber, engine, events, push } = setup();
    push("quiet", 50);
    await transcriber.flush();
    expect(engine.transcribe).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("emits a final for the whole utterance, including pre-roll, once VAD sees the speech end", async () => {
    const { transcriber, calls, events, push } = setup();
    push("quiet", 5); // 500 ms of silence before speech
    push("loud", 5); // 500 ms speech (< partial interval, so no partial)
    push("quiet", 6); // > 500 ms silence hold -> speech-end
    await tick();
    expect(calls).toHaveLength(1);

    // Pre-roll (~300 ms) + speech + trailing silence up to the end event, not the earlier silence.
    const utteranceMs = (calls[0]?.audio.length ?? 0) / (SAMPLE_RATE / 1000);
    expect(utteranceMs).toBeGreaterThanOrEqual(500 + 300);
    expect(utteranceMs).toBeLessThan(500 + 300 + 700);

    await tick();
    calls[0]?.resolve("hello world");
    await transcriber.flush();
    expect(events).toEqual([{ type: "final", text: "hello world", timestamp: expect.any(Number) }]);
  });

  it("runs no partial inferences by default, so finals are never queued behind one", async () => {
    const { calls, push } = setup({ maxUtteranceMs: 12_000 }); // a cap this speech stays under
    push("loud", 40); // far past the partial interval
    await tick();

    expect(calls).toHaveLength(0);

    push("quiet", 6); // speech-end
    await tick();
    expect(calls).toHaveLength(1); // the final, and only the final
  });

  it("emits partials on the interval, with at most one in flight", async () => {
    // A cap this speech stays under, so only partials are inferred.
    const { calls, events, push } = setup({ enablePartials: true, partialIntervalMs: 1000, maxUtteranceMs: 12_000 });
    push("loud", 15); // speech starts ~200 ms in; first interval elapses ~1.2 s in
    await tick();
    expect(calls).toHaveLength(1);

    push("loud", 30); // more intervals elapse while the first is still pending
    await tick();
    expect(calls).toHaveLength(1);

    await tick();
    calls[0]?.resolve("the quarterly");
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ type: "partial", text: "the quarterly" });

    push("loud", 12);
    await tick();
    expect(calls).toHaveLength(2);
  });

  it("drops a partial that finishes after its utterance was finalized", async () => {
    const { transcriber, calls, events, push } = setup({ enablePartials: true, partialIntervalMs: 1000 });
    push("loud", 15);
    await tick();
    expect(calls).toHaveLength(1); // partial pending
    push("quiet", 6); // speech-end -> final queued behind the partial
    await tick();
    calls[0]?.resolve("stale partial");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await tick();
    calls[1]?.resolve("the final text");
    await transcriber.flush();

    expect(events).toEqual([{ type: "final", text: "the final text", timestamp: expect.any(Number) }]);
  });

  it("force-finalizes an utterance at maxUtteranceMs and keeps going", async () => {
    const { transcriber, calls, events, push } = setup({ maxUtteranceMs: 2000, partialIntervalMs: 100_000 });
    push("loud", 25); // 2.5 s of continuous speech
    await tick();
    expect(calls).toHaveLength(1);
    await tick();
    calls[0]?.resolve("first part");
    await vi.waitFor(() => expect(events.map((e) => e.type)).toEqual(["final"]));

    push("loud", 5);
    push("quiet", 6); // the real speech-end still fires afterwards
    await tick();
    expect(calls).toHaveLength(2);
    await tick();
    calls[1]?.resolve("second part");
    await transcriber.flush();
    expect(events.map((e) => (e.type === "final" ? e.text : e.type))).toEqual(["first part", "second part"]);
  });

  it("flush() finalizes an utterance still in progress", async () => {
    const { transcriber, calls, events, push } = setup();
    push("loud", 5);
    const flushed = transcriber.flush();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await tick();
    calls[0]?.resolve("cut off");
    await flushed;
    expect(events).toEqual([{ type: "final", text: "cut off", timestamp: expect.any(Number) }]);
  });

  it("reports engine errors and keeps processing later audio", async () => {
    const { transcriber, calls, events, push } = setup();
    push("loud", 5);
    push("quiet", 6);
    await tick();
    calls[0]?.reject(new Error("Transcription fell behind real time."));
    await transcriber.flush();
    expect(events).toEqual([
      { type: "error", code: "transcription-failed", message: "Transcription fell behind real time." },
    ]);

    push("loud", 5);
    push("quiet", 6);
    await tick();
    calls[1]?.resolve("recovered");
    await transcriber.flush();
    expect(events.at(-1)).toMatchObject({ type: "final", text: "recovered" });
  });

  it("emits nothing for an utterance the engine transcribes as empty", async () => {
    const { transcriber, calls, events, push } = setup();
    push("loud", 5);
    push("quiet", 6);
    await tick();
    calls[0]?.resolve("  ");
    await transcriber.flush();
    expect(events).toEqual([]);
  });

  it("reset() discards buffered audio and drops in-flight results", async () => {
    const { transcriber, calls, events, push } = setup({ enablePartials: true, partialIntervalMs: 1000 });
    push("loud", 15);
    await tick();
    expect(calls).toHaveLength(1);
    transcriber.reset();
    await tick();
    calls[0]?.resolve("should be dropped");
    await transcriber.flush();
    expect(events).toEqual([]);
  });

  it("reset() drops finals still queued behind in-flight inference, so a stopped session cannot bleed into the next", async () => {
    // Inference slower than real time leaves a backlog; without the guard these finals were
    // emitted (and typed) after the user had already started a new capture session.
    const { transcriber, calls, events, push } = setup({ maxUtteranceMs: 1_000 });
    push("loud", 10); // first utterance hits the 1 s cap
    push("loud", 10); // second one too, and queues behind the first
    await tick();
    expect(calls).toHaveLength(1); // only the first is in flight; the second is queued

    transcriber.reset();
    calls[0]?.resolve("first utterance");
    await tick();
    await tick();

    expect(events).toEqual([]);
    expect(calls).toHaveLength(1); // the queued utterance was never even transcribed
  });

  it("applies a lowered chunk length to the utterance already in progress", async () => {
    const { transcriber, calls, push } = setup({ maxUtteranceMs: 20_000 });
    push("loud", 60); // 6 s of speech: well under the original 20 s cap
    await tick();
    expect(calls).toHaveLength(0);

    transcriber.setOptions({ maxUtteranceMs: 4_000 });
    push("loud", 1); // the next push notices it is already past the new cap
    await tick();

    expect(calls).toHaveLength(1);
  });
});

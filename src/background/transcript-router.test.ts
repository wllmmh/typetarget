import { describe, expect, it, vi } from "vitest";
import type { DestinationRef } from "../domain/messages";
import { createInitialState } from "./state";
import { createTranscriptRouter } from "./transcript-router";

const DESTINATION: DestinationRef = { tabId: 7, frameId: 0, elementId: "el-1" };

const setup = (options?: { destination?: DestinationRef | null; insertText?: () => Promise<void> }) => {
  const state = createInitialState();
  state.destination = options?.destination === undefined ? DESTINATION : options.destination;
  const insertText = vi.fn(options?.insertText ?? (async () => {}));
  const onStateChanged = vi.fn();
  const router = createTranscriptRouter({ state, insertText, onStateChanged });
  return { state, insertText, onStateChanged, router };
};

const final = (text: string) => ({ kind: "transcript-event" as const, event: { type: "final" as const, text, timestamp: 0 } });

describe("createTranscriptRouter", () => {
  it("inserts a final into the destination with a space separator", async () => {
    const { router, insertText } = setup();
    await router.handle(final("hello world"));
    expect(insertText).toHaveBeenCalledWith(DESTINATION, "hello world", " ");
  });

  it("inserts finals in the order they arrive, even if an earlier insertion is slow", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const insertText = vi
      .fn<(d: DestinationRef, text: string) => Promise<void>>()
      .mockImplementationOnce(async (_d, text) => {
        await firstGate;
        order.push(text);
      })
      .mockImplementation(async (_d, text) => {
        order.push(text);
      });
    const router = createTranscriptRouter({ state: { ...createInitialState(), destination: DESTINATION }, insertText, onStateChanged: vi.fn() });

    const first = router.handle(final("one"));
    const second = router.handle(final("two"));
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["one", "two"]);
  });

  it("does not insert partials", async () => {
    const { router, insertText } = setup();
    await router.handle({ kind: "transcript-event", event: { type: "partial", text: "hel", timestamp: 0 } });
    expect(insertText).not.toHaveBeenCalled();
  });

  it("reports a missing destination once instead of dropping finals silently", async () => {
    const { router, insertText, state, onStateChanged } = setup({ destination: null });

    await router.handle(final("one"));
    await router.handle(final("two"));

    expect(insertText).not.toHaveBeenCalled();
    expect(state.lastError?.code).toBe("no-destination");
    expect(onStateChanged).toHaveBeenCalledTimes(1);
  });

  it("surfaces transcription errors in state", async () => {
    const { router, state, onStateChanged } = setup();
    await router.handle({
      kind: "transcript-event",
      event: { type: "error", code: "transcription-failed", message: "Transcription fell behind real time." },
    });
    expect(state.lastError).toEqual({ code: "transcription-failed", message: "Transcription fell behind real time." });
    expect(onStateChanged).toHaveBeenCalled();
  });

  it("surfaces an engine error status but ignores loading/ready", async () => {
    const { router, state } = setup();
    await router.handle({ kind: "engine-status", status: { state: "ready", modelId: "tiny.en" } });
    expect(state.lastError).toBeNull();

    await router.handle({ kind: "engine-status", status: { state: "error", message: "boom" } });
    expect(state.lastError).toEqual({ code: "model-load-failed", message: "boom" });
  });

  it("tracks download progress in state so the popup can show it", async () => {
    const { router, state, onStateChanged } = setup();

    await router.handle({ kind: "model-download-progress", modelId: "base.en", receivedBytes: 1000, totalBytes: 4000 });

    expect(state.modelDownload).toEqual({ receivedBytes: 1000, totalBytes: 4000 });
    expect(onStateChanged).toHaveBeenCalled();
  });

  it("clears download progress once the engine reaches a terminal state", async () => {
    const { router, state } = setup();
    await router.handle({ kind: "model-download-progress", modelId: "base.en", receivedBytes: 1000, totalBytes: 4000 });

    await router.handle({ kind: "engine-status", status: { state: "ready", modelId: "base.en" } });

    expect(state.modelDownload).toBeNull();
  });

  it("records pipeline stats for the diagnostics readout", async () => {
    const { router, state, onStateChanged } = setup();

    await router.handle({ kind: "pipeline-stats", batches: 120, droppedBatches: 7, peakLevel: 0.031 });

    expect(state.pipeline).toEqual({ batches: 120, droppedBatches: 7, peakLevel: 0.031 });
    expect(onStateChanged).toHaveBeenCalled();
  });

  it("tracks the engine state so the popup can show whether a model is loaded", async () => {
    const { router, state } = setup();

    await router.handle({ kind: "engine-status", status: { state: "loading", modelId: "tiny.en" } });
    expect(state.engineState).toBe("loading");

    await router.handle({ kind: "engine-status", status: { state: "ready", modelId: "tiny.en" } });
    expect(state.engineState).toBe("ready");
  });

  it("keeps inserting after one insertion fails, and reports it", async () => {
    const insertText = vi.fn().mockRejectedValueOnce(new Error("tab gone")).mockResolvedValue(undefined);
    const state = { ...createInitialState(), destination: DESTINATION };
    const router = createTranscriptRouter({ state, insertText, onStateChanged: vi.fn() });

    await router.handle(final("one"));
    await router.handle(final("two"));

    // A rejected link used to poison the chain, dropping every later final silently.
    expect(state.transcript).toEqual({ finals: 2, inserted: 1 });
    expect(state.lastError).toEqual({ code: "insert-failed", message: "tab gone" });
  });
});

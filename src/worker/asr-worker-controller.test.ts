import { describe, expect, it, vi } from "vitest";
import type { EngineStatus, TranscriptionEngine } from "../domain/models";
import { createAsrWorkerController } from "./asr-worker-controller";
import type { AsrWorkerEvent } from "./worker-protocol";

const setup = (options?: { loadError?: Error }) => {
  let status: EngineStatus = { state: "unloaded" };
  const engine: TranscriptionEngine = {
    getStatus: () => status,
    load: vi.fn(async (modelId) => {
      status = { state: "loading", modelId };
      await Promise.resolve();
      if (options?.loadError) {
        status = { state: "error", message: options.loadError.message };
        throw options.loadError;
      }
      status = { state: "ready", modelId };
    }),
    unload: vi.fn(async () => {
      status = { state: "unloaded" };
    }),
    transcribe: vi.fn(),
    reset: vi.fn(),
  };
  const transcriber = { pushAudio: vi.fn(), flush: vi.fn(async () => {}), reset: vi.fn(), setOptions: vi.fn() };
  const events: AsrWorkerEvent[] = [];
  const controller = createAsrWorkerController({ engine, transcriber, post: (e) => events.push(e) });
  return { controller, engine, transcriber, events };
};

describe("createAsrWorkerController", () => {
  it("posts loading then ready while loading a model", async () => {
    const { controller, engine, events } = setup();
    await controller.handle({ kind: "load-model", modelId: "tiny.en" });
    expect(engine.load).toHaveBeenCalledWith("tiny.en");
    expect(events).toEqual([
      { kind: "engine-status", status: { state: "loading", modelId: "tiny.en" } },
      { kind: "engine-status", status: { state: "ready", modelId: "tiny.en" } },
    ]);
  });

  it("reports a failed load as an error status instead of throwing", async () => {
    const { controller, events } = setup({ loadError: new Error("download failed") });
    await expect(controller.handle({ kind: "load-model", modelId: "tiny.en" })).resolves.toBeUndefined();
    expect(events.at(-1)).toEqual({ kind: "engine-status", status: { state: "error", message: "download failed" } });
  });

  it("drops audio until the engine is ready, then forwards it", async () => {
    const { controller, transcriber } = setup();
    const samples = new Float32Array(160);

    await controller.handle({ kind: "audio", samples });
    expect(transcriber.pushAudio).not.toHaveBeenCalled();

    await controller.handle({ kind: "load-model", modelId: "tiny.en" });
    await controller.handle({ kind: "audio", samples });
    expect(transcriber.pushAudio).toHaveBeenCalledWith(samples);
  });

  it("resets the transcriber when loading and unloading", async () => {
    const { controller, transcriber, engine, events } = setup();
    await controller.handle({ kind: "load-model", modelId: "tiny.en" });
    await controller.handle({ kind: "unload-model" });
    expect(transcriber.reset).toHaveBeenCalledTimes(2);
    expect(engine.unload).toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ kind: "engine-status", status: { state: "unloaded" } });
  });

  it("acknowledges flush once the transcriber has settled", async () => {
    const { controller, transcriber, events } = setup();
    await controller.handle({ kind: "flush" });
    expect(transcriber.flush).toHaveBeenCalled();
    expect(events).toEqual([{ kind: "flushed" }]);
  });

  it("forwards reset to the transcriber", async () => {
    const { controller, transcriber } = setup();
    await controller.handle({ kind: "reset" });
    expect(transcriber.reset).toHaveBeenCalled();
  });

  it("retunes the chunk length without restarting anything", async () => {
    const { controller, transcriber } = setup();

    await controller.handle({ kind: "set-chunk-ms", chunkMs: 6_000 });

    expect(transcriber.setOptions).toHaveBeenCalledWith({ maxUtteranceMs: 6_000 });
    expect(transcriber.reset).not.toHaveBeenCalled();
  });
});

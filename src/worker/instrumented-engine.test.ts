import { describe, expect, it, vi } from "vitest";
import type { TranscriptionEngine } from "../domain/models";
import { createInstrumentedEngine, type InferenceStats } from "./instrumented-engine";

const baseEngine = (transcribe: TranscriptionEngine["transcribe"]): TranscriptionEngine => ({
  load: vi.fn(),
  unload: vi.fn(),
  reset: vi.fn(),
  getStatus: () => ({ state: "ready", modelId: "tiny.en" }),
  transcribe,
});

const setup = (transcribe: TranscriptionEngine["transcribe"]) => {
  const reports: InferenceStats[] = [];
  let clock = 0;
  const engine = createInstrumentedEngine(baseEngine(transcribe), (s) => reports.push(s), () => clock);
  return { engine, reports, tick: (ms: number) => (clock += ms) };
};

describe("createInstrumentedEngine", () => {
  it("reports a call as started before it completes, so a stuck inference is visible", async () => {
    let release: (() => void) | undefined;
    const { engine, reports } = setup(async () => {
      await new Promise<void>((r) => (release = r));
      return { text: "hi" };
    });

    const pending = engine.transcribe(new Float32Array(10));
    expect(reports.at(-1)).toMatchObject({ started: 1, finished: 0 });

    release?.();
    await pending;
    expect(reports.at(-1)).toMatchObject({ started: 1, finished: 1 });
  });

  it("records how long the last call took", async () => {
    const { engine, reports, tick } = setup(async () => {
      tick(13_000);
      return { text: "hi" };
    });

    await engine.transcribe(new Float32Array(10));

    expect(reports.at(-1)?.lastMs).toBe(13_000);
  });

  it("counts failures separately and still rethrows", async () => {
    const { engine, reports } = setup(async () => {
      throw new Error("boom");
    });

    await expect(engine.transcribe(new Float32Array(10))).rejects.toThrow("boom");
    expect(reports.at(-1)).toMatchObject({ started: 1, finished: 0, failed: 1 });
  });

  it("passes options through and returns the wrapped engine's result", async () => {
    const transcribe = vi.fn(async () => ({ text: "hello" }));
    const { engine } = setup(transcribe);

    await expect(engine.transcribe(new Float32Array(4), { language: "en" })).resolves.toEqual({ text: "hello" });
    expect(transcribe).toHaveBeenCalledWith(expect.any(Float32Array), { language: "en" });
  });
});

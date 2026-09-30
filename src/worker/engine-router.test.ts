import { describe, expect, it, vi } from "vitest";
import type { EngineStatus, TranscriptionEngine } from "../domain/models";
import { EngineRouter, type ProviderImpl } from "./engine-router";

const fakeProvider = (): ProviderImpl & { engine: TranscriptionEngine } => {
  let status: EngineStatus = { state: "unloaded" };
  const engine: TranscriptionEngine = {
    getStatus: () => status,
    load: vi.fn(async (modelId) => {
      status = { state: "ready", modelId };
    }),
    unload: vi.fn(async () => {
      status = { state: "unloaded" };
    }),
    transcribe: vi.fn(async () => ({ text: "" })),
    reset: vi.fn(async () => {}),
  };
  const transcriber = { pushAudio: vi.fn(), flush: vi.fn(async () => {}), reset: vi.fn(), setOptions: vi.fn() };
  return { engine, transcriber };
};

describe("EngineRouter", () => {
  it("routes load() to the provider matching the model's catalog entry", async () => {
    const whisper = fakeProvider();
    const gemini = fakeProvider();
    const router = new EngineRouter({ providers: { "whisper-cpp": whisper, "gemini-live": gemini, groq: fakeProvider() } });

    await router.load("tiny.en");

    expect(whisper.engine.load).toHaveBeenCalledWith("tiny.en");
    expect(gemini.engine.load).not.toHaveBeenCalled();
    expect(router.getStatus()).toEqual({ state: "ready", modelId: "tiny.en" });
  });

  it("unloads the previously active provider when switching providers", async () => {
    const whisper = fakeProvider();
    const gemini = fakeProvider();
    const router = new EngineRouter({ providers: { "whisper-cpp": whisper, "gemini-live": gemini, groq: fakeProvider() } });

    await router.load("tiny.en");
    await router.load("gemini-3.5-transcribe-live");

    expect(whisper.engine.unload).toHaveBeenCalledTimes(1);
    expect(gemini.engine.load).toHaveBeenCalledWith("gemini-3.5-transcribe-live");
  });

  it("routes Groq models to the groq provider", async () => {
    const whisper = fakeProvider();
    const groq = fakeProvider();
    const router = new EngineRouter({ providers: { "whisper-cpp": whisper, "gemini-live": fakeProvider(), groq } });

    await router.load("tiny.en");
    await router.load("groq-whisper-large-v3-turbo");

    expect(whisper.engine.unload).toHaveBeenCalledTimes(1);
    expect(groq.engine.load).toHaveBeenCalledWith("groq-whisper-large-v3-turbo");
  });

  it("does not unload when reloading the same provider", async () => {
    const whisper = fakeProvider();
    const gemini = fakeProvider();
    const router = new EngineRouter({ providers: { "whisper-cpp": whisper, "gemini-live": gemini, groq: fakeProvider() } });

    await router.load("tiny.en");
    await router.load("base.en");

    expect(whisper.engine.unload).not.toHaveBeenCalled();
  });

  it("routes pushAudio/flush/setOptions to the active provider's transcriber", async () => {
    const whisper = fakeProvider();
    const gemini = fakeProvider();
    const router = new EngineRouter({ providers: { "whisper-cpp": whisper, "gemini-live": gemini, groq: fakeProvider() } });
    await router.load("tiny.en");

    const samples = new Float32Array(4);
    router.pushAudio(samples);
    await router.flush();
    router.setOptions({ maxUtteranceMs: 5_000 });

    expect(whisper.transcriber.pushAudio).toHaveBeenCalledWith(samples);
    expect(whisper.transcriber.flush).toHaveBeenCalled();
    expect(whisper.transcriber.setOptions).toHaveBeenCalledWith({ maxUtteranceMs: 5_000 });
    expect(gemini.transcriber.pushAudio).not.toHaveBeenCalled();
  });

  it("routes reset() to the active provider's transcriber, not its engine", async () => {
    const whisper = fakeProvider();
    const gemini = fakeProvider();
    const router = new EngineRouter({ providers: { "whisper-cpp": whisper, "gemini-live": gemini, groq: fakeProvider() } });
    await router.load("tiny.en");

    await router.reset();

    expect(whisper.transcriber.reset).toHaveBeenCalled();
    expect(whisper.engine.reset).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is loaded", async () => {
    const whisper = fakeProvider();
    const gemini = fakeProvider();
    const router = new EngineRouter({ providers: { "whisper-cpp": whisper, "gemini-live": gemini, groq: fakeProvider() } });

    expect(router.getStatus()).toEqual({ state: "unloaded" });
    router.pushAudio(new Float32Array(4));
    await expect(router.flush()).resolves.toBeUndefined();
    await expect(router.reset()).resolves.toBeUndefined();
    await expect(router.transcribe(new Float32Array(4))).rejects.toThrow("No transcription engine loaded.");
  });
});

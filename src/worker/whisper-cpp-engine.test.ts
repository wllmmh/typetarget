import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhisperCppEngine } from "./whisper-cpp-engine";
import type { WhisperModule, WhisperModuleFactory, WhisperModuleOverrides } from "./whisper-module";

const MODEL_URLS = {
  "tiny.en": "https://example.com/tiny.en.bin",
  "tiny.en-q5_1": "https://example.com/tiny.en-q5_1.bin",
  "base.en": "https://example.com/base.en.bin",
};

/** Builds a fake WhisperModule plus the factory that loads it. Like the real build,
 * the fake only sees print/printErr via the overrides passed at load time (Emscripten
 * reads them once at startup); full_default asynchronously "finishes" by calling
 * them, simulating the real background thread's printf calls. */
const createFakeModule = (options?: {
  segmentLines?: string[];
  contextIndexFromInit?: number;
  fullDefaultResultCode?: number;
  neverFinishes?: boolean;
  fsUnlinkError?: unknown;
}): { module: WhisperModule; factory: WhisperModuleFactory } => {
  const segmentLines = options?.segmentLines ?? ["[00:00:00.000 --> 00:00:01.000]  hello world"];
  let print: WhisperModuleOverrides["print"] = () => {};
  let printErr: WhisperModuleOverrides["printErr"] = () => {};

  const module: WhisperModule = {
    init: vi.fn(() => options?.contextIndexFromInit ?? 1),
    free: vi.fn(),
    full_default: vi.fn(() => {
      if (options?.neverFinishes) return options?.fullDefaultResultCode ?? 0;
      queueMicrotask(() => {
        for (const line of segmentLines) print(line);
        printErr("whisper_print_timings:     load time =    12.34 ms");
      });
      return options?.fullDefaultResultCode ?? 0;
    }),
    FS_createDataFile: vi.fn(),
    FS_unlink: vi.fn(() => {
      if (options?.fsUnlinkError) throw options.fsUnlinkError;
    }),
  };
  const factory: WhisperModuleFactory = vi.fn(async (overrides) => {
    ({ print, printErr } = overrides);
    return module;
  });
  return { module, factory };
};

const createEngine = ({ factory }: ReturnType<typeof createFakeModule>) =>
  new WhisperCppEngine({
    loadModuleFactory: () => Promise.resolve(factory),
    modelUrls: MODEL_URLS,
  });

beforeEach(() => {
  const modelBytesStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(modelBytesStream, { status: 200, headers: { "content-length": "3" } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WhisperCppEngine.load", () => {
  it("downloads the model, writes it to the module FS, and initializes a context", async () => {
    const fakeModule = createFakeModule();
    const engine = createEngine(fakeModule);

    await engine.load("tiny.en");

    expect(fakeModule.module.FS_createDataFile).toHaveBeenCalledWith(
      "/",
      "ggml-tiny.en.bin",
      expect.any(Uint8Array),
      true,
      true,
    );
    expect(fakeModule.module.init).toHaveBeenCalledWith("ggml-tiny.en.bin");
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "tiny.en" });
  });

  it("tolerates FS_unlink reporting ENOENT (no stale model file on first load)", async () => {
    // Shape of Emscripten's FS.ErrnoError for a missing file.
    const fakeModule = createFakeModule({ fsUnlinkError: { name: "ErrnoError", errno: 44 } });
    const engine = createEngine(fakeModule);

    await engine.load("tiny.en");

    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "tiny.en" });
  });

  it("propagates other FS_unlink failures", async () => {
    const fakeModule = createFakeModule({ fsUnlinkError: { name: "ErrnoError", errno: 13 } });
    const engine = createEngine(fakeModule);

    await expect(engine.load("tiny.en")).rejects.toEqual({ name: "ErrnoError", errno: 13 });
    expect(engine.getStatus().state).toBe("error");
  });

  it("reports an error status when the module fails to init a context", async () => {
    const fakeModule = createFakeModule({ contextIndexFromInit: 0 });
    const engine = createEngine(fakeModule);

    await expect(engine.load("tiny.en")).rejects.toThrow(/failed to initialize/);
    expect(engine.getStatus().state).toBe("error");
  });
});

describe("WhisperCppEngine.transcribe", () => {
  it("throws when called before a model is loaded", async () => {
    const engine = createEngine(createFakeModule());
    await expect(engine.transcribe(new Float32Array(10))).rejects.toThrow(/still loading/);
  });

  it("resolves with parsed segment text once the background thread signals completion", async () => {
    const fakeModule = createFakeModule({
      segmentLines: [
        "[00:00:00.000 --> 00:00:01.000]  hello",
        "[00:00:01.000 --> 00:00:02.000]  world",
      ],
    });
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");

    const result = await engine.transcribe(new Float32Array(16_000));

    expect(result.text).toBe("hello world");
  });

  it("throws when full_default returns a non-zero result code", async () => {
    const fakeModule = createFakeModule({ fullDefaultResultCode: -1 });
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");

    await expect(engine.transcribe(new Float32Array(16_000))).rejects.toThrow(/failed with code -1/);
  });

  it("times out with 'Transcription fell behind real time.' when no completion signal arrives", async () => {
    const fakeModule = createFakeModule({ neverFinishes: true });
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en"); // real timers: model download uses real fetch/stream promises

    vi.useFakeTimers();
    try {
      const transcribePromise = engine.transcribe(new Float32Array(16_000));
      const assertion = expect(transcribePromise).rejects.toThrow("Transcription fell behind real time.");
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leak one call's output into the next", async () => {
    const fakeModule = createFakeModule({ segmentLines: ["[00:00:00.000 --> 00:00:01.000]  hello"] });
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");

    const first = await engine.transcribe(new Float32Array(16_000));
    const second = await engine.transcribe(new Float32Array(16_000));

    expect(first.text).toBe("hello");
    expect(second.text).toBe("hello");
  });
});

describe("WhisperCppEngine.unload", () => {
  it("frees the context and resets status to unloaded", async () => {
    const fakeModule = createFakeModule();
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");

    await engine.unload();

    expect(fakeModule.module.free).toHaveBeenCalledWith(1);
    expect(engine.getStatus()).toEqual({ state: "unloaded" });
  });

  it("is safe to call when nothing was loaded", async () => {
    const engine = createEngine(createFakeModule());
    await expect(engine.unload()).resolves.toBeUndefined();
  });
});

describe("WhisperCppEngine repeated loads", () => {
  it("does nothing when the same model is already loaded (Stop then Start)", async () => {
    const fakeModule = createFakeModule();
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");

    await engine.load("tiny.en");

    // A second init would mean a second whisper context for the same model.
    expect(fakeModule.module.init).toHaveBeenCalledTimes(1);
  });

  it("frees the previous context when switching models, since the module is shared", async () => {
    const fakeModule = createFakeModule();
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");

    await engine.load("base.en");

    expect(fakeModule.module.free).toHaveBeenCalledWith(1);
    expect(fakeModule.module.init).toHaveBeenCalledTimes(2);
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "base.en" });
  });
});

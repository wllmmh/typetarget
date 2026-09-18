import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhisperCppEngine } from "./whisper-cpp-engine";
import type { WhisperModule, WhisperModuleFactory } from "./whisper-module";

const MODEL_URLS = { "tiny.en": "https://example.com/tiny.en.bin", "base.en": "https://example.com/base.en.bin" };

/** Builds a fake WhisperModule whose full_default asynchronously "finishes" by
 * calling the captured printErr/print callbacks, simulating the real background
 * thread's printf calls. */
const createFakeModule = (options?: {
  segmentLines?: string[];
  contextIndexFromInit?: number;
  fullDefaultResultCode?: number;
  neverFinishes?: boolean;
}): WhisperModule => {
  const segmentLines = options?.segmentLines ?? ["[00:00:00.000 --> 00:00:01.000]  hello world"];
  let print: (text: string) => void = () => {};
  let printErr: (text: string) => void = () => {};

  return {
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
    FS_unlink: vi.fn(),
    get print() {
      return print;
    },
    set print(fn) {
      print = fn;
    },
    get printErr() {
      return printErr;
    },
    set printErr(fn) {
      printErr = fn;
    },
  };
};

const createEngine = (fakeModule: WhisperModule) => {
  const factory: WhisperModuleFactory = vi.fn().mockResolvedValue(fakeModule);
  return new WhisperCppEngine({
    loadModuleFactory: () => Promise.resolve(factory),
    modelUrls: MODEL_URLS,
  });
};

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

    expect(fakeModule.FS_createDataFile).toHaveBeenCalledWith(
      "/",
      "ggml-tiny.en.bin",
      expect.any(Uint8Array),
      true,
      true,
    );
    expect(fakeModule.init).toHaveBeenCalledWith("ggml-tiny.en.bin");
    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "tiny.en" });
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

  it("restores the module's original print/printErr after finishing", async () => {
    const fakeModule = createFakeModule();
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");
    const printAfterLoad = fakeModule.print;
    const printErrAfterLoad = fakeModule.printErr;

    await engine.transcribe(new Float32Array(16_000));

    expect(fakeModule.print).toBe(printAfterLoad);
    expect(fakeModule.printErr).toBe(printErrAfterLoad);
  });
});

describe("WhisperCppEngine.unload", () => {
  it("frees the context and resets status to unloaded", async () => {
    const fakeModule = createFakeModule();
    const engine = createEngine(fakeModule);
    await engine.load("tiny.en");

    await engine.unload();

    expect(fakeModule.free).toHaveBeenCalledWith(1);
    expect(engine.getStatus()).toEqual({ state: "unloaded" });
  });

  it("is safe to call when nothing was loaded", async () => {
    const engine = createEngine(createFakeModule());
    await expect(engine.unload()).resolves.toBeUndefined();
  });
});

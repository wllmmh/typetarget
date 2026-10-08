/**
 * TranscriptionEngine implementation backed by whisper.cpp's WASM build. This is the
 * *only* module in the codebase allowed to know about whisper.cpp's specific API
 * shape (init/free/full_default, stdout-based results) — everything above it
 * (worker message handling, streaming/stabilization, UI) talks to the
 * TranscriptionEngine interface in domain/models.ts, per AGENTS.md "Model
 * abstraction": "The rest of the application must not depend directly on
 * whisper.cpp internals."
 */
import type { EngineStatus, ModelId, TranscriptionEngine, TranscriptionOptions, TranscriptionResult, WhisperModelId } from "../domain/models";
import { MODEL_CATALOG } from "../domain/models";
import type { WhisperModule, WhisperModuleFactory } from "./whisper-module";
import { parseWhisperOutput } from "./whisper-line-parser";
import { ensureModelDownloaded, type ModelSource } from "./model-downloader";

const MODEL_FILENAME_IN_FS: Record<WhisperModelId, string> = {
  "tiny.en": "ggml-tiny.en.bin",
  "tiny.en-q5_1": "ggml-tiny.en-q5_1.bin",
  "base.en": "ggml-base.en.bin",
  "tiny.en-q8_0": "ggml-tiny.en-q8_0.bin",
  "base.en-q5_1": "ggml-base.en-q5_1.bin",
  "base.en-q8_0": "ggml-base.en-q8_0.bin",
  "small.en-q5_1": "ggml-small.en-q5_1.bin",
  "small.en-q8_0": "ggml-small.en-q8_0.bin",
  "small.en": "ggml-small.en.bin",
  "medium.en-q5_0": "ggml-medium.en-q5_0.bin",
  "medium.en-q8_0": "ggml-medium.en-q8_0.bin",
};

/** EngineRouter only ever loads this engine for whisper-cpp-provider models, but
 * TranscriptionEngine.load() must accept any ModelId (it's the cross-provider
 * interface) — this narrows before touching anything whisper-specific. */
const isWhisperModelId = (id: ModelId): id is WhisperModelId => MODEL_CATALOG[id].provider === "whisper-cpp";

/** Emscripten FS `ErrnoError.errno` for "no such file" (musl's ENOENT). */
const ENOENT = 44;

/** Removes a stale copy of `path` from the module FS (e.g. from a previous load); a missing file is expected on first load. */
const unlinkIfPresent = (module: WhisperModule, path: string) => {
  try {
    module.FS_unlink(path);
  } catch (err) {
    const isMissingFile = typeof err === "object" && err !== null && "errno" in err && err.errno === ENOENT;
    if (!isMissingFile) throw err;
  }
};

export type WhisperCppEngineConfig = {
  /**
   * Loads (or returns an already-loaded) whisper.cpp module factory. Takes a
   * factory-loader function rather than a glue-script URL so this engine has no
   * dependency on `importScripts`/worker-global wiring (see whisper-module.ts's
   * loadWhisperModuleFactory for the real production loader) and can be tested with
   * a fake module without a Worker environment.
   */
  loadModuleFactory: () => Promise<WhisperModuleFactory>;
  /** Where to download each model's .bin file from, if not already cached. */
  modelUrls: ModelSource;
  onDownloadProgress?: (progress: { modelId: ModelId; receivedBytes: number; totalBytes: number }) => void;
};

export class WhisperCppEngine implements TranscriptionEngine {
  private status: EngineStatus = { state: "unloaded" };
  private module: WhisperModule | null = null;
  private contextIndex: number | null = null;
  // Emscripten reads print/printErr once at startup (see whisper-module.ts), so the
  // module gets these two fixed forwarders and transcribe() swaps the sinks instead.
  private stdoutSink: (line: string) => void = () => {};
  private stderrSink: (line: string) => void = () => {};

  constructor(private readonly config: WhisperCppEngineConfig) {}

  async load(modelId: ModelId): Promise<void> {
    if (!isWhisperModelId(modelId)) {
      this.status = { state: "error", message: `WhisperCppEngine cannot load non-whisper model "${modelId}".` };
      throw new Error(this.status.message);
    }

    // Stop/Start sends load-model again; re-initialising an already-loaded model would
    // re-read it from the cache and leak the previous whisper context for no gain.
    if (this.status.state === "ready" && this.status.modelId === modelId) return;

    this.status = { state: "loading", modelId };
    try {
      const modelBytes = await ensureModelDownloaded(modelId, this.config.modelUrls, (progress) =>
        this.config.onDownloadProgress?.({ modelId, ...progress }),
      );

      const factory = await this.config.loadModuleFactory();
      const module = await factory({
        // whisper.cpp's realtime segment output arrives here; buffered per-inference
        // by transcribe() below, not consumed at load time.
        print: (line) => this.stdoutSink(line),
        printErr: (line) => this.stderrSink(line),
      });

      // The module is shared for the worker's lifetime, so a context from an earlier load
      // must be freed here rather than left dangling.
      if (this.contextIndex !== null) {
        module.free(this.contextIndex);
        this.contextIndex = null;
      }

      const filename = MODEL_FILENAME_IN_FS[modelId];
      unlinkIfPresent(module, `/${filename}`);
      module.FS_createDataFile("/", filename, new Uint8Array(modelBytes), true, true);

      const contextIndex = module.init(filename);
      if (contextIndex === 0) {
        throw new Error(`whisper.cpp failed to initialize a context for model "${modelId}".`);
      }

      this.module = module;
      this.contextIndex = contextIndex;
      this.status = { state: "ready", modelId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error loading the Whisper model.";
      this.status = { state: "error", message };
      throw err;
    }
  }

  async unload(): Promise<void> {
    if (this.module && this.contextIndex !== null) {
      this.module.free(this.contextIndex);
    }
    this.module = null;
    this.contextIndex = null;
    this.status = { state: "unloaded" };
  }

  async transcribe(audio: Float32Array, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    if (!this.module || this.contextIndex === null) {
      throw new Error("Whisper model is still loading.");
    }

    const capturedStdout: string[] = [];
    const module = this.module;
    this.stdoutSink = (line) => capturedStdout.push(line);

    // Completion signal. The vendored build runs inference *synchronously* (see
    // third_party/whisper-wasm/single-thread.patch: upstream detaches a std::thread, which
    // aborts without pthreads), so by the time full_default() returns the marker below has
    // already been printed and the poll resolves on its first tick. The marker is still
    // what's waited on rather than the return value, because it is the one signal that holds
    // for both the synchronous and upstream-threaded builds.
    //
    // whisper_print_timings() is the last call either way, and its first line is
    // unconditionally
    // "whisper_print_timings:     load time = ..." (confirmed in whisper.cpp's
    // source, src/whisper.cpp, whisper_print_timings()/whisper_log_callback_default()).
    // That goes through whisper.cpp's *default* log callback, which writes to
    // stderr (fputs(text, stderr)) — Emscripten routes stderr through the exported
    // `printErr` runtime method, not `print` (stdout, used only by the plain
    // printf() segment lines). Watching for that marker on printErr is therefore a
    // real signal tied to the actual last statement of the background thread, not a
    // guessed delay.
    let inferenceFinished = false;
    this.stderrSink = (line) => {
      if (line.includes("whisper_print_timings")) inferenceFinished = true;
    };

    try {
      // `nthreads` is ignored by the vendored single-threaded build (the patch forces
      // n_threads = 1); it is still passed so the signature matches upstream's.
      const resultCode = module.full_default(this.contextIndex, audio, options?.language ?? "en", 1, false);
      if (resultCode !== 0) {
        throw new Error(`whisper.cpp inference failed with code ${resultCode}.`);
      }

      // This only guards a completion marker that never arrives. It can't detect slow
      // inference: full_default() blocks the worker, so nothing ticks while it runs. Falling
      // behind real time is judged in the popup instead, from the inference stats.
      await pollUntil(() => inferenceFinished, {
        timeoutMs: 30_000,
        onTimeout: "Transcription did not finish.",
      });

      const segments = parseWhisperOutput(capturedStdout.join("\n"));
      const text = segments.map((s) => s.text).join(" ").trim();
      return { text };
    } finally {
      this.stdoutSink = () => {};
      this.stderrSink = () => {};
    }
  }

  async reset(): Promise<void> {
    // whisper.cpp's context itself is stateless across full_default calls (no
    // running decoder state to clear), so reset() has nothing engine-specific to do
    // today; kept as a real method (not a no-op comment) so the interface contract
    // holds if that changes.
  }

  getStatus(): EngineStatus {
    return this.status;
  }
}

/** Polls `check()` until it's true or `timeoutMs` elapses, without a busy-loop (setTimeout-paced). */
const pollUntil = (
  check: () => boolean,
  { timeoutMs, intervalMs = 20, onTimeout }: { timeoutMs: number; intervalMs?: number; onTimeout: string },
): Promise<void> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(onTimeout));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });

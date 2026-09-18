/**
 * TranscriptionEngine implementation backed by whisper.cpp's WASM build. This is the
 * *only* module in the codebase allowed to know about whisper.cpp's specific API
 * shape (init/free/full_default, stdout-based results) — everything above it
 * (worker message handling, streaming/stabilization, UI) talks to the
 * TranscriptionEngine interface in domain/models.ts, per AGENTS.md "Model
 * abstraction": "The rest of the application must not depend directly on
 * whisper.cpp internals."
 */
import type { EngineStatus, ModelId, TranscriptionEngine, TranscriptionOptions, TranscriptionResult } from "../domain/models";
import type { WhisperModule, WhisperModuleFactory } from "./whisper-module";
import { parseWhisperOutput } from "./whisper-line-parser";
import { ensureModelDownloaded, type ModelSource } from "./model-downloader";

const MODEL_FILENAME_IN_FS: Record<ModelId, string> = {
  "tiny.en": "ggml-tiny.en.bin",
  "base.en": "ggml-base.en.bin",
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

  constructor(private readonly config: WhisperCppEngineConfig) {}

  async load(modelId: ModelId): Promise<void> {
    this.status = { state: "loading", modelId };
    try {
      const modelBytes = await ensureModelDownloaded(modelId, this.config.modelUrls, (progress) =>
        this.config.onDownloadProgress?.({ modelId, ...progress }),
      );

      const factory = await this.config.loadModuleFactory();
      const module = await factory({
        // whisper.cpp's realtime segment output arrives here; buffered per-inference
        // by transcribe() below, not consumed at load time.
        print: () => {},
        printErr: () => {},
      });

      const filename = MODEL_FILENAME_IN_FS[modelId];
      module.FS_unlink(`/${filename}`);
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
    const originalPrint = module.print;
    const originalPrintErr = module.printErr;
    module.print = (line: string) => capturedStdout.push(line);

    // Completion signal: full_default() starts inference on a background
    // std::thread and returns immediately (confirmed from emscripten.cpp source) —
    // there is no direct return value or callback for "inference finished." Its
    // thread body calls whisper_print_timings() as its last step before the thread
    // ends, and that function's first line is unconditionally
    // "whisper_print_timings:     load time = ..." (confirmed in whisper.cpp's
    // source, src/whisper.cpp, whisper_print_timings()/whisper_log_callback_default()).
    // That goes through whisper.cpp's *default* log callback, which writes to
    // stderr (fputs(text, stderr)) — Emscripten routes stderr through the exported
    // `printErr` runtime method, not `print` (stdout, used only by the plain
    // printf() segment lines). Watching for that marker on printErr is therefore a
    // real signal tied to the actual last statement of the background thread, not a
    // guessed delay.
    let inferenceFinished = false;
    module.printErr = (line: string) => {
      if (line.includes("whisper_print_timings")) inferenceFinished = true;
    };

    try {
      // `nthreads` is a runtime param independent of the module's own pthread pool
      // size (see whisper-module.ts); 4 balances throughput against not starving
      // the rest of the extension's contexts on typical desktop hardware. Not
      // benchmarked yet — see AGENTS.md "Performance targets".
      const resultCode = module.full_default(this.contextIndex, audio, options?.language ?? "en", 4, false);
      if (resultCode !== 0) {
        throw new Error(`whisper.cpp inference failed with code ${resultCode}.`);
      }

      await pollUntil(() => inferenceFinished, {
        timeoutMs: 30_000,
        onTimeout: "Transcription fell behind real time.", // exact wording from AGENTS.md "Error handling"
      });

      const segments = parseWhisperOutput(capturedStdout.join("\n"));
      const text = segments.map((s) => s.text).join(" ").trim();
      return { text };
    } finally {
      module.print = originalPrint;
      module.printErr = originalPrintErr;
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

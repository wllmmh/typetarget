/**
 * Type contract for whisper.cpp's compiled WASM module (Emscripten + Embind), as
 * confirmed against the exact source of examples/whisper.wasm/emscripten.cpp:
 * https://github.com/ggml-org/whisper.cpp/blob/master/examples/whisper.wasm/emscripten.cpp
 *
 *   size_t init(const std::string & path_model)
 *   void   free(size_t index)
 *   int    full_default(size_t index, const emscripten::val & audio, const std::string & lang, int nthreads, bool translate)
 *
 * `full_default` does not return transcript text — it starts inference on a
 * background std::thread and returns immediately (0 on success). Segment text
 * arrives via whisper.cpp's internal per-segment printf (params.print_realtime=true),
 * a plain stdout printf routed to the `print` handler supplied at load time (see
 * whisper-line-parser.ts). Completion of that background
 * thread is separately signaled through `Module.printErr` (stderr), because
 * whisper_print_timings() — the last call the thread makes — goes through
 * whisper.cpp's default log callback, which writes to stderr, not stdout (see
 * whisper-cpp-engine.ts for exactly how this is used as a completion marker).
 *
 * `print`/`printErr` are read by Emscripten exactly once, at runtime startup
 * (`if (Module["print"]) out = Module["print"]`), so they can only be supplied as
 * load-time overrides — reassigning them on the module afterwards has no effect.
 *
 * The actual libmain.js glue + libmain.wasm binary are not npm packages — they are
 * build output from whisper.cpp's own CMake/Emscripten build
 * (examples/whisper.wasm/CMakeLists.txt) and must be vendored under
 * third_party/whisper-wasm/ (see docs/whisper-wasm-provenance.md). This module only
 * declares the shape; it does not embed or fetch the actual files.
 */

export type WhisperModule = {
  init: (pathModel: string) => number;
  free: (index: number) => void;
  full_default: (
    index: number,
    audio: Float32Array,
    lang: string,
    nthreads: number,
    translate: boolean,
  ) => number;
  /** Emscripten FS helpers, exported via `-s FORCE_FILESYSTEM=1` (confirmed in the CMakeLists link flags). */
  FS_createDataFile: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
  ) => void;
  FS_unlink: (path: string) => void;
};

/** Output handlers handed to Emscripten at startup; see the note on `print`/`printErr` above. */
export type WhisperModuleOverrides = {
  print: (text: string) => void;
  printErr: (text: string) => void;
};

export type WhisperModuleFactory = (overrides: WhisperModuleOverrides) => Promise<WhisperModule>;

/**
 * Returns a factory for the vendored whisper.cpp WASM build. The build in
 * third_party/whisper-wasm/libmain.js is a classic (non-MODULARIZE) Emscripten script:
 * it reads a pre-populated global `Module`, and Embind attaches `init`/`free`/
 * `full_default` and the FS helpers to that same object once the runtime is up
 * (signalled by `Module.onRuntimeInitialized`). It also re-loads its own script URL in
 * each pthread worker, so `glueScriptUrl` must be a stable, fetchable URL.
 *
 * One runtime per worker: the script is imported once, and every call returns that
 * same module. Overrides passed on the first call are the ones that stay in effect.
 */
export const loadWhisperModuleFactory = async (glueScriptUrl: string): Promise<WhisperModuleFactory> => {
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error(
      "SharedArrayBuffer is not available in this context, but whisper.cpp's WASM build requires it " +
        "(it's compiled with pthreads). The extension manifest sets COOP/COEP to cross-origin-isolate " +
        "its pages; if this fires, that isolation isn't in effect for this context (or, in a plain " +
        "browser/test harness, launch with cross-origin isolation enabled). See " +
        "docs/whisper-wasm-provenance.md, which also covers rebuilding whisper.cpp without pthreads.",
    );
  }

  let loaded: Promise<WhisperModule> | null = null;

  return (overrides) => {
    loaded ??= new Promise<WhisperModule>((resolve, reject) => {
      // The glue starts its runtime asynchronously after importScripts returns, so a
      // startup failure (e.g. Embind's `new Function` blocked by the extension CSP)
      // surfaces as an unhandled rejection / uncaught error, not through onAbort.
      // Without these listeners the promise would never settle.
      const onRuntimeError = (event: PromiseRejectionEvent | ErrorEvent) => {
        const reason = "reason" in event ? event.reason : event.error ?? event.message;
        settle(() => reject(new Error(`whisper.cpp WASM runtime failed to start: ${String(reason)}`)));
      };
      const settle = (action: () => void) => {
        self.removeEventListener("unhandledrejection", onRuntimeError);
        self.removeEventListener("error", onRuntimeError);
        action();
      };
      self.addEventListener("unhandledrejection", onRuntimeError);
      self.addEventListener("error", onRuntimeError);

      const module: Record<string, unknown> = {
        ...overrides,
        onRuntimeInitialized: () => settle(() => resolve(module as unknown as WhisperModule)),
        onAbort: (reason: unknown) =>
          settle(() => reject(new Error(`whisper.cpp WASM runtime aborted: ${String(reason)}`))),
      };
      // `self` is typed as DedicatedWorkerGlobalScope ("WebWorker" lib), which doesn't
      // know about the dynamically-read `Module` global the glue script consumes.
      (self as unknown as { Module: Record<string, unknown> }).Module = module;
      try {
        importScripts(glueScriptUrl);
      } catch (err) {
        settle(() => reject(err));
      }
    });
    return loaded;
  };
};

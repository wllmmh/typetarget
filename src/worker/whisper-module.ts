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
 * a plain stdout printf captured via the exported `print` Emscripten runtime method
 * into `Module.print` (see whisper-line-parser.ts). Completion of that background
 * thread is separately signaled through `Module.printErr` (stderr), because
 * whisper_print_timings() — the last call the thread makes — goes through
 * whisper.cpp's default log callback, which writes to stderr, not stdout (see
 * whisper-cpp-engine.ts for exactly how this is used as a completion marker).
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
  /** Overridden by the caller to capture whisper.cpp's stdout (see whisper-cpp-engine.ts). */
  print: (text: string) => void;
  printErr: (text: string) => void;
};

export type WhisperModuleFactory = (overrides: Partial<WhisperModule>) => Promise<WhisperModule>;

/**
 * Loads the vendored whisper.cpp WASM glue script and returns its module factory.
 * Emscripten's default (non-ES-module) output attaches a factory function to the
 * global scope when loaded via importScripts in a Worker — this wraps that in a
 * promise-based loader so callers don't touch globals directly.
 */
export const loadWhisperModuleFactory = async (glueScriptUrl: string): Promise<WhisperModuleFactory> => {
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error(
      "SharedArrayBuffer is not available in this context, but whisper.cpp's WASM build requires it " +
        "(it's compiled with pthreads). Chrome gates SharedArrayBuffer behind cross-origin isolation. " +
        "See docs/whisper-wasm-provenance.md for how to rebuild whisper.cpp without pthreads (slower, " +
        "single-threaded, no SharedArrayBuffer needed) or how to run Chrome with the isolation flag enabled.",
    );
  }

  importScripts(glueScriptUrl);
  // Emscripten's MODULARIZE output attaches a factory function named after the
  // CMake target (`libmain` per examples/whisper.wasm/CMakeLists.txt) to the worker
  // global scope. `self` is typed as DedicatedWorkerGlobalScope by the caller's tsconfig
  // ("WebWorker" lib), which doesn't know about this dynamically-attached property.
  const factory = (self as unknown as { libmain?: WhisperModuleFactory }).libmain;
  if (!factory) {
    throw new Error(
      `whisper.cpp WASM glue script at "${glueScriptUrl}" did not expose the expected module factory.`,
    );
  }
  return factory;
};

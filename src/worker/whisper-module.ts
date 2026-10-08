/**
 * Type contract for whisper.cpp's compiled WASM module (Emscripten + Embind), from
 * examples/whisper.wasm/emscripten.cpp. `full_default` returns a status code, not text:
 * segment text arrives on the `print` handler (stdout) and completion is signalled on
 * `printErr` (stderr). Both handlers are read once, at runtime startup, so they can only
 * be supplied as load-time overrides.
 *
 * The glue (third_party/whisper-wasm/libmain.js, wasm embedded) is our own build, not an
 * npm package; this module only declares its shape. See docs/specs/whisper-wasm-provenance.md.
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
 * (signalled by `Module.onRuntimeInitialized`).
 *
 * One runtime per worker: the script is imported once, and every call returns that
 * same module. Overrides passed on the first call are the ones that stay in effect.
 *
 * The vendored build is single-threaded on purpose (`-s USE_PTHREADS=0`): pthreads need
 * cross-origin isolation, which puts extension pages in a different render process from the
 * service worker, and a tabCapture stream id can only be consumed in the caller's process.
 * See docs/adr/0001-single-threaded-whisper-build-to-keep-tab-capture.md.
 */
export const loadWhisperModuleFactory = async (glueScriptUrl: string): Promise<WhisperModuleFactory> => {
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

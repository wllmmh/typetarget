# whisper.cpp WASM: what is vendored and how to rebuild it

The local engine (`src/worker/whisper-cpp-engine.ts`) runs whisper.cpp compiled to
WebAssembly. The compiled glue is **not committed** (`third_party/whisper-wasm/*.js` is
gitignored). This file records what it is, where it came from, and the API the engine depends
on. Why it is built this way: [ADR 0001](../adr/0001-single-threaded-whisper-build-to-keep-tab-capture.md)
(single-threaded) and [ADR 0002](../adr/0002-whisper-glue-built-from-source-without-dynamic-execution.md)
(built from source).

## The artifact

One file, `third_party/whisper-wasm/libmain.js`: a single-file Emscripten build with the wasm
embedded (`WHISPER_WASM_SINGLE_FILE=ON`). There is no separate `libmain.wasm`. The build copies
it to `dist/whisper/libmain.js` (`vite.config.ts`), and the worker loads it from that fixed
path.

- whisper.cpp commit `5670d5c0bbcb148feabef84400a07cfca9aa3b30` (2026-09-18, master)
- Emscripten 6.0.9, cmake 4.4.3 and ninja from PyPI
- Changes from upstream:
  - `examples/whisper.wasm/CMakeLists.txt` `LINK_FLAGS`: add `-s DYNAMIC_EXECUTION=0`, change
    `-s USE_PTHREADS=1` to `-s USE_PTHREADS=0`, and drop `-s PTHREAD_POOL_SIZE_STRICT=0`.
  - `third_party/whisper-wasm/single-thread.patch` (apply with `git apply`): runs inference
    synchronously instead of on a detached `std::thread`, and forces `params.n_threads = 1`.
- sha256 `f00f6efeb6820e269bc5a62c826346bf2bf3ac8c3e2089aacb559467ef82f005` (1,565,970 bytes)

## Rebuild

```sh
git clone https://github.com/emscripten-core/emsdk.git && (cd emsdk && ./emsdk install latest && ./emsdk activate latest)
git clone https://github.com/ggml-org/whisper.cpp.git && cd whisper.cpp
git checkout 5670d5c0bbcb148feabef84400a07cfca9aa3b30
git apply <repo>/third_party/whisper-wasm/single-thread.patch
# edit LINK_FLAGS in examples/whisper.wasm/CMakeLists.txt as listed above
source ../emsdk/emsdk_env.sh
emcmake cmake -B build-em -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_WASM_SINGLE_FILE=ON -DGGML_OPENMP=OFF
cmake --build build-em --target libmain -j 8
cp build-em/bin/libmain.js <repo>/third_party/whisper-wasm/libmain.js
```

The build is not bit-reproducible across toolchain versions. After a rebuild, check that the
glue contains no `new Function` or `eval(`, and run a transcription in the built extension.

## Glue shape

The build is a classic script, not a MODULARIZE factory. It reads a pre-populated global
`Module`, attaches the Embind exports (`init`, `free`, `full_default`) and the FS helpers
(`FS_createDataFile`, `FS_unlink`, exported via `-s FORCE_FILESYSTEM=1`) to that same object,
and calls `Module.onRuntimeInitialized` when ready. `loadWhisperModuleFactory`
(`src/worker/whisper-module.ts`) wraps this in a promise. Each worker has one runtime, and the
script is imported once.

Things that are easy to get wrong:

- **`print` and `printErr` are read once, at startup** (`if (Module["print"]) out =
  Module["print"]`). Reassigning them later has no effect, so the engine passes fixed
  forwarders at load and swaps the per-call sinks behind them.
- **The worker entry must be a classic (IIFE) bundle.** A pthreads build spawns each pthread
  as `new Worker(self.location.href, { name: "em-pthread" })`, and such instances must do
  nothing but `importScripts` the glue. The shipped build has no pthreads, but
  `src/worker/main.ts` keeps the guard so a threaded build also works.
- **`FS_unlink` on a missing file throws** `ErrnoError` with errno 44 (ENOENT). The engine
  tolerates exactly that.

## API

From `examples/whisper.wasm/emscripten.cpp` at the pinned commit:

```cpp
size_t init(const std::string & path_model);   // returns 1-based context index, 0 on failure
void   free(size_t index);
int    full_default(size_t index, const emscripten::val & audio,
                     const std::string & lang, int nthreads, bool translate);
```

`full_default` returns a status code, not text. Segment text arrives through `printf` calls
(`params.print_realtime = true`) routed to the `print` override (stdout), in the form
`[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text` (`src/worker/whisper-line-parser.ts`). Completion is
signalled on `printErr` (stderr) by the first line of `whisper_print_timings()`, which goes
through whisper.cpp's default log callback (`fputs(text, stderr)`) after `whisper_full()`
returns. With the vendored patch, inference is synchronous, so the marker has already been
printed when `full_default` returns. Upstream runs it on a background thread and returns
immediately, and the marker works for both.

If a whisper.cpp upgrade changes this output format or the binding signatures, the parser and
the completion detection in `whisper-cpp-engine.ts` must be checked again.

## Model files

Downloaded at runtime ([ADR 0003](../adr/0003-models-downloaded-at-runtime-and-cached.md)) from
the mirror whisper.cpp's own `models/download-ggml-model.sh` uses:

```
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<model>.bin
```

The supported models and their URLs are in `src/worker/model-urls.ts`, with sizes in
`MODEL_CATALOG` (`src/domain/models.ts`). The WASM heap tops out near 2 GB (512 MB initial,
growable to ~1.94 GiB), which rules out full-precision `medium.en` and every large model.

## Verified against the real binary

- 2026-09-18: the vendored build and `ggml-tiny.en.bin` transcribed `jfk.wav` correctly on a
  plain page. This confirmed the binding names and signatures, the stdout segment format, the
  stderr completion marker and the ENOENT behaviour.
- 2026-09-22 onwards: the full pipeline (tab capture → offscreen → worker → insertion) has run
  end to end in Chrome, using the single-threaded build.

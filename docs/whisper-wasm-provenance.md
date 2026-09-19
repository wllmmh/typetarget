# whisper.cpp WASM: what to vendor and how

This extension's ASR engine (`src/worker/whisper-cpp-engine.ts`) is written against
whisper.cpp's official browser example. The compiled glue script is **not committed**
(`third_party/whisper-wasm/*.js` is gitignored) — this file says where it came from
and how to get it again.

## What's needed

One file, vendored at `third_party/whisper-wasm/libmain.js`: a **single-file**
Emscripten build (wasm embedded, ~1.8 MB), i.e. `WHISPER_WASM_SINGLE_FILE=ON`, the
project default. No separate `libmain.wasm` exists.

### Where the vendored copy came from

**Built from source, not downloaded.** The hosted demo build
(`https://ggml.ai/whisper.cpp/libmain.js`) does not work in this extension — see
"Why it is built from source" below. The vendored file is our own build:

- whisper.cpp commit `5670d5c0bbcb148feabef84400a07cfca9aa3b30` (2026-09-18, master)
- Emscripten 6.0.9 (emsdk `latest` at the time), cmake 4.4.3 + ninja from PyPI
- one change to `examples/whisper.wasm/CMakeLists.txt`: add `-s DYNAMIC_EXECUTION=0`
  to the `LINK_FLAGS` list (after `-s FORCE_FILESYSTEM=1`)
- sha256 of the result: `d9611649f3fc2c1a00fc9567067115c8e2c02c87f199f78230adcc647753a22b` (1,832,762 bytes)

Rebuild recipe:

```
git clone https://github.com/emscripten-core/emsdk.git && (cd emsdk && ./emsdk install latest && ./emsdk activate latest)
git clone https://github.com/ggml-org/whisper.cpp.git && cd whisper.cpp
git checkout 5670d5c0bbcb148feabef84400a07cfca9aa3b30
# add "-s DYNAMIC_EXECUTION=0 \" to LINK_FLAGS in examples/whisper.wasm/CMakeLists.txt
source ../emsdk/emsdk_env.sh
emcmake cmake -B build-em -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_WASM_SINGLE_FILE=ON
cmake --build build-em --target libmain -j 8
cp build-em/bin/libmain.js <repo>/third_party/whisper-wasm/libmain.js
```

The build is not bit-reproducible across toolchain versions; re-verify after any rebuild.

### Glue shape: classic global `Module`, not a factory

This is **not** a MODULARIZE build — there is no `libmain` factory function. The
script reads a pre-populated global `Module`, attaches Embind exports (`init`, `free`,
`full_default`) and the FS helpers to that same object, and calls
`Module.onRuntimeInitialized` when ready. `loadWhisperModuleFactory`
(`src/worker/whisper-module.ts`) wraps that in a promise: it sets `self.Module`, calls
`importScripts`, and resolves on `onRuntimeInitialized` (rejects on `onAbort`). One
runtime per worker; the script is imported once.

Two consequences that are easy to get wrong:

1. **`print`/`printErr` are read once, at startup** (`if (Module["print"]) out =
   Module["print"]`). Reassigning them on the module afterwards does nothing. They
   must be supplied as load-time overrides; the engine passes fixed forwarders and
   swaps per-call sinks behind them.
2. **pthread workers are spawned from the worker's own URL.** In a worker the build
   sets `_scriptName = self.location.href` (no `mainScriptUrlOrBlob` support), and
   each pthread is `new Worker(<that URL>, { name: "em-pthread" })` — a *classic*
   worker. So the ASR worker entry must be a classic (IIFE) bundle, and when
   `self.name === "em-pthread"` it must do nothing except `importScripts` the glue
   script.

## SharedArrayBuffer / cross-origin isolation

The build uses pthreads, so it needs `SharedArrayBuffer`, which Chrome gates behind
cross-origin isolation. The extension gets that from its manifest — no browser launch
flag needed:

```
"cross_origin_embedder_policy": { "value": "require-corp" },
"cross_origin_opener_policy":   { "value": "same-origin" }
```

(`manifest.config.ts`, spread in from `crossOriginIsolation` because crxjs's types
lack these keys.) Effect on extension pages incl. the offscreen document and its
workers. Consequence of `require-corp`: cross-origin subresources must be fetched
with CORS; the Hugging Face model download works this way (verified).

`loadWhisperModuleFactory` still checks for `SharedArrayBuffer` first and throws a
specific error if isolation isn't in effect — intentional, not a bug to fix.
Fallback if isolation ever becomes unworkable: rebuild without pthreads
(`-s USE_PTHREADS=0`; slower, single-threaded; the CMakeLists hardcodes this, so it
would need forking).

## Verified against the real binary

On 2026-09-18 the vendored build + real `ggml-tiny.en.bin` were checked twice:

1. Plain COOP/COEP-served page, `WhisperCppEngine.transcribe` on `jfk.wav`: correct
   transcript. Confirmed the Embind names/signatures below, the stdout segment format,
   the stderr completion marker, and the model fetch under `require-corp`. It also
   surfaced that `FS_unlink` on a not-yet-existing model file throws `ErrnoError`
   errno 44 (ENOENT) — the engine now tolerates exactly that.
2. **Built extension loaded into Chrome**, worker started from an extension page:
   `crossOriginIsolated` true (manifest COOP/COEP suffice), model loaded (~8.7 s),
   `jfk.wav` fed in 100 ms chunks through `StreamingTranscriber` produced correct
   finals split at the speaker's pauses. This is what exposed the CSP problem below
   (against the hosted build) and confirmed the rebuild fixes it.

Both were one-off manual harnesses, not repo tests; unit tests use fakes. Not yet
verified: the offscreen document itself (only an extension page hosting the same
worker), live tab audio, partial results under real-time pacing.

## Why it is built from source: the MV3 CSP

The hosted `libmain.js` cannot run in an MV3 extension. Loading the built extension
into Chrome and starting the worker from an extension page (2026-09-18) failed at
runtime startup with `EvalError: Evaluating a string as JavaScript violates ...
'unsafe-eval'`. Embind builds its call invokers with `new Function(...)`
(`createJsInvoker`, and the emval method callers), and MV3 extension pages cannot
allow `unsafe-eval`; the `'wasm-unsafe-eval'` we do set covers only WebAssembly
compilation. (A plain page without a CSP hides this, which is how the first check
passed.) Building with `-sDYNAMIC_EXECUTION=0` removes those sites — the rebuilt glue
contains no `new Function` / `eval(`.

`loadWhisperModuleFactory` rejects on asynchronous runtime-startup errors, so a
failure of this kind surfaces as a clear "runtime failed to start" error instead of a
hang.

## Model files

Downloaded at runtime (not bundled — see AGENTS.md "Model storage"), from:

```
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<model>.bin
```

confirmed from whisper.cpp's own `models/download-ggml-model.sh`. This project uses
`tiny.en` and `base.en` — i.e.:

- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin` (77,704,715 bytes, verified 2026-09-18)
- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`

Only the `tiny.en` size has been verified (above). `base.en` is commonly cited as
~142MB — unverified; check the live Hugging Face listing before hardcoding it in UI copy.

## Verified API shape (do not re-derive from memory — check against the actual
## vendored files' version once available)

Confirmed directly from `examples/whisper.wasm/emscripten.cpp` source at the time of
writing (pin/re-check against whatever commit the vendored build actually comes
from):

```cpp
size_t init(const std::string & path_model);   // returns 1-based context index, 0 on failure
void   free(size_t index);
int    full_default(size_t index, const emscripten::val & audio,
                     const std::string & lang, int nthreads, bool translate);
```

`full_default` starts inference on a background `std::thread` and returns
immediately — it does not return transcript text. Segment text arrives via plain
`printf` calls (`params.print_realtime = true`) routed to the load-time `print`
override (stdout); the format is `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text` (confirmed against
whisper.cpp's own README example output and its `to_timestamp()` implementation in
`src/whisper.cpp`). Completion of the background thread is signaled by watching
the `printErr` override (stderr) for the substring `"whisper_print_timings"` — the first
line whisper.cpp's default log callback (`whisper_log_callback_default`,
`fputs(text, stderr)`) prints once `whisper_full()` returns and the thread's last
statement (`whisper_print_timings(...)`) runs. See `src/worker/whisper-cpp-engine.ts`
for exactly how this is used.

**If a future whisper.cpp version changes this output format or API shape**, that's
a breaking change to this engine's parsing (`src/worker/whisper-line-parser.ts`) and
completion detection — re-verify both against whatever version is actually vendored,
don't assume this doc stays accurate forever.

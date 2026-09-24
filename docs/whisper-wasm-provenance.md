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
- two changes to `examples/whisper.wasm/CMakeLists.txt`'s `LINK_FLAGS`: add
  `-s DYNAMIC_EXECUTION=0` and change `-s USE_PTHREADS=1` to `-s USE_PTHREADS=0`
  (also drop the now-meaningless `-s PTHREAD_POOL_SIZE_STRICT=0`)
- sha256 of the result: `f00f6efeb6820e269bc5a62c826346bf2bf3ac8c3e2089aacb559467ef82f005` (1,565,970 bytes)

Rebuild recipe:

```
git clone https://github.com/emscripten-core/emsdk.git && (cd emsdk && ./emsdk install latest && ./emsdk activate latest)
git clone https://github.com/ggml-org/whisper.cpp.git && cd whisper.cpp
git checkout 5670d5c0bbcb148feabef84400a07cfca9aa3b30
# add "-s DYNAMIC_EXECUTION=0 \" to LINK_FLAGS in examples/whisper.wasm/CMakeLists.txt
source ../emsdk/emsdk_env.sh
emcmake cmake -B build-em -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_WASM_SINGLE_FILE=ON
emcmake cmake -B build-em -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_WASM_SINGLE_FILE=ON -DGGML_OPENMP=OFF
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

## Why the build is single-threaded: cross-origin isolation vs tabCapture

whisper.cpp's stock WASM build uses pthreads, which needs `SharedArrayBuffer`, which Chrome
gates behind cross-origin isolation. The extension can turn that on with manifest keys
(`cross_origin_embedder_policy: require-corp` + `cross_origin_opener_policy: same-origin`),
and that does work: extension pages then report `crossOriginIsolated === true` and the
pthreads build runs.

**But it breaks tab capture, which is the whole point of the extension.** Cross-origin
isolation is enforced at process level, so an isolated extension page gets its own render
process, while the service worker stays non-isolated (verified in Chrome 153:
`crossOriginIsolated` is `false` in the service worker and `true` on extension pages). A
`tabCapture` stream id may only be consumed "in the same render process as the caller", so
`getMediaStreamId` in the service worker succeeded and the offscreen document's
`getUserMedia` then failed with Chrome's `Error starting tab capture`. That was a real
user-visible failure, not a theory.

The two requirements are mutually exclusive with one offscreen document (an extension may
only have one, and a service worker cannot spawn a `Worker`). Capture is non-negotiable, so
**pthreads loses**: the vendored build is `-s USE_PTHREADS=0`, needs no `SharedArrayBuffer`,
and the COOP/COEP manifest keys are gone. `nthreads` passed to `full_default` is therefore
inert.

Dropping pthreads needs a **source patch as well as flags**, kept at
`third_party/whisper-wasm/single-thread.patch` (apply with `git apply` in a whisper.cpp
checkout). Upstream's `full_default` detaches a `std::thread` to run `whisper_full`, which
aborts immediately in a no-pthreads build (`RuntimeError: Aborted()` on the first
transcribe, while `init` still succeeded). The patch runs inference synchronously instead
and forces `params.n_threads = 1`. This is transparent to callers: the
`whisper_print_timings` completion marker is printed before `full_default` returns.

**Cost, measured on this machine (12-core desktop, headless Chrome, tiny.en, same clip):**

| build | per-inference |
| --- | --- |
| pthreads, 4 threads, `audio_ctx` 1500 | ~3.3 s |
| single-threaded, `audio_ctx` 1500 | ~13.5 s |
| single-threaded + `-msimd128`, `audio_ctx` 1500 | ~12.8-14.1 s |
| single-threaded + `-msimd128`, `audio_ctx` 768 | ~7.1 s first call, then **hangs** (see correction below) |

**Re-measured 2026-09-23** (same machine class: Ryzen 5 3600, 6C/12T; headless Chrome 153;
`bench/whisper-bench.html` driven via Playwright; real speech — slices of whisper.cpp's
`samples/jfk.wav` — plus the harness's 3 s silence; every number is steady-state over ≥2
repeated calls on one context):

| build / model | 11 s clip | 5 s clip |
| --- | --- | --- |
| single-threaded (shipping), `tiny.en` | ~13.4 s | — |
| single-threaded, `tiny.en-q5_1` | ~10.4 s | ~9.5 s |
| single-threaded, `tiny.en-q5_1`, fitted `audio_ctx` (288) | — | **~1.9 s** |
| pthreads ×4, `tiny.en` | ~3.6 s | — |
| pthreads ×6, `tiny.en` (×8 is no faster: 6 physical cores) | ~2.4 s | ~2.3 s |
| pthreads ×6, `tiny.en-q5_1` | ~1.8 s | ~2.0 s |
| pthreads ×6, `tiny.en-q5_1`, fitted `audio_ctx` | — | **~0.4 s** |

Transcripts were identical across builds/models at full context.

Two things that look like levers and are not:

- **`-msimd128` bought nothing measurable** (~13 s either way) — **because it was already
  on in both rows, not because SIMD doesn't help.** `ggml/src/ggml-cpu/CMakeLists.txt`
  unconditionally sets `COMPILE_FLAGS "-msimd128"` on the CPU backend target whenever
  `EMSCRIPTEN` is set (confirmed at the exact pinned commit below), so the vendored build
  already compiles with WASM SIMD regardless of any flag added elsewhere. The
  `-msimd128` that was added and measured here went into
  `examples/whisper.wasm/CMakeLists.txt`'s `LINK_FLAGS`, which only affects the link
  step and cannot change how `ggml-cpu`'s object files were already compiled — a no-op
  by construction. There is no disabled SIMD path to find; see HANDOFF.md "Lever 4" for
  the full trace (source-level only — this sandbox had no `wasm-objdump`/`emsdk` to
  confirm against the compiled `.wasm` directly; re-verify against the binary if that
  tooling is available).
- **`audio_ctx` is not usable here, and is deliberately NOT in the patch.** Shrinking the
  encoder context is the obvious fix for the 30 s-window cost and it does work — once. Two
  variants were measured: sized per request with a 256 floor (first call 2.5 s) and a fixed
  768 (first call 7.1 s, vs 12.8 s at 1500). In **both** cases the *second* `full_default`
  call never returned, while the same build without `audio_ctx` ran call after call at a
  steady ~13 s. So something about a reduced `audio_ctx` leaves the context unusable for the
  next call. Anyone retrying this must test **repeated** inferences on one context, not a
  single call.

  **Correction (2026-09-23): it was not a hang.** Re-tested with a rebuilt binding that
  takes `audio_ctx` per call (`bench/single-thread-full-opts.patch`), on both the
  single-threaded and pthreads builds: repeated calls on one context — including changing
  `audio_ctx` between calls — work indefinitely. What happens instead is that when the
  reduced window fits the audio badly, the decoder degenerates (repetition / garbage) and
  whisper's temperature fallback re-decodes up to 5 times at up to ~224 tokens each:
  **64–103 s per call single-threaded** — indistinguishable from a hang, and past the
  engine's 30 s timeout. Short utterances (≤~4 s) are where this happens, and the old
  per-request variant's 256 floor put every short utterance there. With the window sized to
  the audio + ~0.5 s it is correct and 4–5× faster for utterances ≥~4.5 s; below that no
  margin was reliably correct (dropped speech, repetition). `max_tokens` + no fallback bounds
  the worst case to ~1–2 s but does not fix those transcripts. Still not in the shipping
  patch — see HANDOFF.md "Lever 2".

A quantized model (`ggml-tiny.en-q5_1.bin` from the same Hugging Face repo — a pure model
swap, no C++ change) is now wired in as a selectable model (`src/domain/models.ts`,
`src/worker/model-urls.ts`) but **not benchmarked** — see HANDOFF.md "Lever 3" and
`bench/whisper-bench.html`. Remaining untried lever: getting threads back by replacing
`tabCapture` with `chrome.desktopCapture`, whose stream ids are origin-verified rather
than process-verified (adds a picker and a permission) — see HANDOFF.md "Lever 1".

If a future build ever wants threads back, it must solve the process split first — re-adding
the manifest keys alone will silently break capture again.

## Verified against the real binary

On 2026-09-18 the vendored build + real `ggml-tiny.en.bin` were checked twice:

1. Plain COOP/COEP-served page, `WhisperCppEngine.transcribe` on `jfk.wav`: correct
   transcript. Confirmed the Embind names/signatures below, the stdout segment format,
   the stderr completion marker, and the model fetch under `require-corp`. It also
   surfaced that `FS_unlink` on a not-yet-existing model file throws `ErrnoError`
   errno 44 (ENOENT) — the engine now tolerates exactly that.
2. **Built extension loaded into Chrome**, worker started from an extension page (this was
   done against the earlier *pthreads* build, when COOP/COEP were still set):
   `crossOriginIsolated` true, model loaded (~8.7 s),
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
`tiny.en`, `tiny.en-q5_1`, and `base.en` — i.e.:

- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin` (77,704,715 bytes, verified 2026-09-18)
- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin` (32,166,155 bytes, verified 2026-09-22 — see HANDOFF.md "Lever 3")
- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`

`base.en`'s size has not been independently verified; it is commonly cited as ~142MB —
check the live Hugging Face listing before hardcoding it in UI copy.

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

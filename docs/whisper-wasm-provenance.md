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

There is no GitHub release artifact. The copy in use was downloaded from the official
demo, served by GitHub Pages:

```
curl -L -o third_party/whisper-wasm/libmain.js https://ggml.ai/whisper.cpp/libmain.js
```

- sha256 at the time of download (2026-09-18): `144f4bf8c2cf43c3224037b487bae497a280ee2b5ccaa45cdf54448bf6f11e8a`
- The URL is **unversioned** (it tracks the demo's latest build), so the whisper.cpp
  commit is unknown. Re-check the checksum before assuming a re-download is identical,
  and re-run the real-binary check below if it differs.
- To pin a known commit instead, build from
  [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  `examples/whisper.wasm/` with Emscripten (`emcmake` + `emmake`).

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

On 2026-09-18, the vendored `libmain.js` + real `ggml-tiny.en.bin` were run through
`WhisperCppEngine` + `loadWhisperModuleFactory` in headless Chromium (page served with
COOP/COEP headers, worker built as an IIFE per the rules above) on `jfk.wav`. It
transcribed correctly. That confirmed: the Embind names/signatures below, the stdout
segment format, the stderr completion marker, and cross-origin isolation with the
model fetch. It also surfaced that `FS_unlink` on a not-yet-existing model file throws
`ErrnoError` errno 44 (ENOENT) — the engine now tolerates exactly that. This was a
one-off manual harness, not a repo test; unit tests still use a fake module.

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

# whisper.cpp WASM: what to vendor and how

This extension's ASR engine (`src/worker/whisper-cpp-engine.ts`) is written against
whisper.cpp's official browser example, but the compiled `.wasm`/`.js` artifacts
themselves are **not included in this repo** — they aren't an npm package, and this
sandbox has no Emscripten toolchain to build them. This file is the checklist for
whoever provides them.

## What's needed

Two files, vendored under `third_party/whisper-wasm/`:

- `libmain.js` — Emscripten glue/loader (attaches a `libmain` factory function to
  the global scope; see `src/worker/whisper-module.ts`).
- `libmain.wasm` — the compiled WASM binary (only produced as a separate file if
  built with `WHISPER_WASM_SINGLE_FILE=OFF`; the project's default embeds the wasm
  as base64 inside `libmain.js` instead, in which case only one file exists).

Source: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp),
`examples/whisper.wasm/` — built via its `CMakeLists.txt` + Emscripten (`emcmake` +
`emmake`), **not** a prebuilt release artifact as far as could be confirmed; check the
repo's releases page for a hosted prebuilt before rebuilding from source.

## Build flags — read before building

The project's default `examples/whisper.wasm/CMakeLists.txt` link flags set
`-s USE_PTHREADS=1`, which requires `SharedArrayBuffer` at runtime. Chrome gates
`SharedArrayBuffer` behind cross-origin isolation; there is an open, unresolved
whisper.cpp issue (#2437) reporting `"SharedArrayBuffer is not defined"` in Chrome
with no in-repo fix.

This project's decision (per the person building it): **use the stock pthreads
build as-is**, and handle the SharedArrayBuffer requirement operationally rather
than by rebuilding whisper.cpp:

- For local development/testing, launch Chromium with SharedArrayBuffer explicitly
  enabled, e.g. `brave-browser --enable-features=SharedArrayBuffer` (or the
  equivalent Chrome flag).
- `src/worker/whisper-module.ts`'s `loadWhisperModuleFactory` checks for
  `SharedArrayBuffer` up front and throws a clear, actionable error (not a silent
  failure) if it's unavailable, naming both remediation paths: launching the browser
  with the flag, or rebuilding whisper.cpp with `-s USE_PTHREADS=0` (slower,
  single-threaded, no SharedArrayBuffer needed — CMakeLists.txt would need to be
  forked/patched to make that flag configurable, since it's currently hardcoded).

## Model files

Downloaded at runtime (not bundled — see AGENTS.md "Model storage"), from:

```
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<model>.bin
```

confirmed from whisper.cpp's own `models/download-ggml-model.sh`. This project uses
`tiny.en` and `base.en` — i.e.:

- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin`
- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`

Exact file sizes were not independently verified in this session (check the live
Hugging Face file listing before hardcoding a size in UI copy); commonly-cited
approximate sizes are ~75MB (tiny.en) and ~142MB (base.en) — treat as unverified
until confirmed against the live listing.

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
`printf` calls (`params.print_realtime = true`) captured through `Module.print`
(stdout); the format is `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text` (confirmed against
whisper.cpp's own README example output and its `to_timestamp()` implementation in
`src/whisper.cpp`). Completion of the background thread is signaled by watching
`Module.printErr` (stderr) for the substring `"whisper_print_timings"` — the first
line whisper.cpp's default log callback (`whisper_log_callback_default`,
`fputs(text, stderr)`) prints once `whisper_full()` returns and the thread's last
statement (`whisper_print_timings(...)`) runs. See `src/worker/whisper-cpp-engine.ts`
for exactly how this is used.

**If a future whisper.cpp version changes this output format or API shape**, that's
a breaking change to this engine's parsing (`src/worker/whisper-line-parser.ts`) and
completion detection — re-verify both against whatever version is actually vendored,
don't assume this doc stays accurate forever.

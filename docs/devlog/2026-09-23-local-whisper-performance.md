# Local Whisper performance: cost model, measurements and levers
- Dates: 2026-09-18 to 2026-09-23 (direction settled 2026-10-08)

Notes from the work on making in-browser Whisper keep up live. Since
[ADR 0010](../adr/0010-hosted-models-for-live-transcription.md) this is optional: hosted
models give live transcription to most users. These notes are kept for anyone who wants to
widen the set of machines that can run local Whisper live.

## Cost model

Whisper's encoder always runs over a fixed 30 s window and pads shorter audio, so the cost of
each inference call is roughly constant, whatever length of audio it carries. Two
consequences:

- **Keeping up** requires `inference_cost < chunk_length`.
- **Latency** is about `chunk_length + inference_cost`, plus a backlog that grows without
  limit once the first inequality fails.

At ~13.5 s per call (single-threaded `tiny.en`), a chunk has to hold at least ~14 s of audio
just to break even, which puts the output ~33 s behind the speaker at a 20 s chunk. Getting
within ~3 s of live needs ~1 s per call, a ~13× speedup. No single lever gives that.

## Measurements

First pass (12-core desktop, headless Chrome, `tiny.en`, same clip):

| Build | Per inference |
| --- | --- |
| pthreads, 4 threads | ~3.3 s |
| single-threaded (what ships) | ~13.5 s |
| single-threaded + `-msimd128` link flag | ~12.8–14.1 s |

Second pass, 2026-09-23 (Ryzen 5 3600, 6C/12T; headless Chrome 153; `bench/whisper-bench.html`
driven by Playwright; slices of whisper.cpp's `samples/jfk.wav`; steady state over ≥2
repeated calls on one context):

| Build / model | 11 s clip | 5 s clip |
| --- | --- | --- |
| single-threaded, `tiny.en` | ~13.4 s | — |
| single-threaded, `tiny.en-q5_1` | ~10.4 s | ~9.5 s |
| single-threaded, `tiny.en-q5_1`, fitted `audio_ctx` (288) | — | **~1.9 s** |
| pthreads ×4, `tiny.en` | ~3.6 s | — |
| pthreads ×6, `tiny.en` (×8 is no faster: 6 physical cores) | ~2.4 s | ~2.3 s |
| pthreads ×6, `tiny.en-q5_1` | ~1.8 s | ~2.0 s |
| pthreads ×6, `tiny.en-q5_1`, fitted `audio_ctx` | — | **~0.4 s** |

Transcripts were identical across builds and models at full context.

## Levers

### Threads: ~5.8× at 6 threads, blocked by tab capture

The threaded build (`bench/libmain-threaded.js`, rebuild recipe in
[bench/README.md](../../bench/README.md)) runs correctly in Chrome and scales close to
linearly up to the physical core count: 13.8 s → 6.5 s (×2) → 3.4 s (×4) → 2.3 s (×6). It
cannot ship alongside `tabCapture`
([ADR 0001](../adr/0001-single-threaded-whisper-build-to-keep-tab-capture.md)).

The way around that is `chrome.desktopCapture`, whose stream ids are checked by origin and can
be consumed from an isolated page. What was found about it:

- `chooseDesktopMedia` always shows an OS picker and cannot be pre-targeted at a tab.
  `targetTab` only limits which tab may later redeem the stream id.
- In MV3, calling it from the service worker without `targetTab` throws
  (`GoogleChrome/chrome-extensions-samples#1073`).
- So the user would pick the tab twice, once in TypeTarget and once in the OS picker, unless
  TypeTarget's own source selection were dropped. That is a product decision, and it was not
  taken.

Expect smaller gains on limited hardware (2–3× on 4 cores), from a worse single-thread
baseline.

### `audio_ctx`: 4–5× for utterances of 4.5 s or more, no threads needed

Shrinking the encoder window (`audio_ctx`, in 20 ms frames; 1500 = 30 s) to fit the audio
removes the padding cost. It was measured with a per-call binding
(`bench/single-thread-full-opts.patch`: `full_opts(index, audio, lang, nthreads, translate,
audio_ctx, single_segment, no_timestamps, temperature_inc, max_tokens)`, which also sets
`no_context = true`).

- For utterances of ~4.5 s or more, `audio_ctx = ceil((seconds + 0.5) * 50 / 32) * 32` was
  correct in every case tried, and 4–5× faster: single-threaded `q5_1`, 5 s → 1.9 s and 8 s →
  2.9 s (vs ~9.5 s at full context).
- For utterances of ~4 s or less, no margin was reliably correct. Output repeated itself,
  turned to garbage or came back empty, and the results were not monotonic in the margin.
- An early test looked like a **hang** on the second call. That was a misdiagnosis. A
  degenerate decode triggers temperature fallback (up to 5 retries of up to ~224 tokens), which
  took 64–103 s per call single-threaded, past the engine's 30 s timeout. The early variant's
  floor of 256 frames put every short utterance in that regime.
- `max_tokens ≈ 5/s + 8` with `temperature_inc = 0` caps the worst case at ~1–2 s but does not
  make short clips correct. `single_segment` and `no_timestamps` made results worse.

To ship this, the policy would be: fit `audio_ctx` (plus the token cap) for utterances of
4.5 s or more and keep full context below that. Short VAD utterances would still cost ~9.5 s,
so it only pays off fully with a minimum utterance length before a pause may finalize. The
evidence is one clean 11 s clip with one speaker, so it would need testing on varied tab
audio first.

### Quantized models: ~1.3×, same transcript (shipped)

`tiny.en-q5_1` is a pure model swap, with no C++ change: 2.4× smaller and ~1.3× faster, with
an identical transcript. It became the default on 2026-10-08.

ggml's hand-written WASM-SIMD quantized kernels (`ggml-cpu/arch/wasm/quants.c`) are not
compiled into this build. They are gated on `CMAKE_SYSTEM_PROCESSOR MATCHES "wasm"`, and
Emscripten's toolchain file sets that variable to `"x86"`, so ggml falls back to its generic
kernels (confirmed from the compiled object list). Passing
`-DEMSCRIPTEN_SYSTEM_PROCESSOR=wasm` is untried.

### `-msimd128`: not a lever

The "no gain" reading came from adding `-msimd128` to the example's `LINK_FLAGS`, which cannot
change already-compiled objects. ggml's `ggml-cpu/CMakeLists.txt` already compiles the CPU
backend with `-msimd128` whenever `EMSCRIPTEN` is set (checked at the pinned commit), and
`simd-mappings.h` enables its F32 SIMD path on `__wasm_simd128__`. Both rows of the first
table had SIMD on. This is source-level evidence; it has not been confirmed against the
compiled `.wasm`.

### A different model architecture

Streaming-first models (for example Moonshine-class models on ONNX Runtime Web) cost time in
proportion to the audio actually given, which removes the fixed-window problem at its root. It
would be a backend swap behind `TranscriptionEngine`, not a tuning change.

## Bench method

- `bench/whisper-bench.html`, served by `bench/serve.mjs` (which adds COOP/COEP for the
  threaded build).
- Playwright from the npx cache with `executablePath: /usr/bin/google-chrome`, and model
  requests fulfilled from local copies via `page.route`. `page.route` does not see the pthread
  workers' fetch of the glue script, so a threaded build under test has to be on disk under
  the served root.
- The production build blocks the page inside the Run click handler, so automation has to
  click through a deferred `setTimeout`.
- The toolchain (emsdk, cmake, ninja, installed without root) and whisper.cpp checkouts are at
  `/home/will/typetarget-toolchain/` on the original dev machine, outside the repo. The
  single-threaded checkout is a worktree at `whisper.cpp-st`. The threaded checkout carries
  the `full_opts` binding, so its `build-em` output no longer matches
  `bench/libmain-threaded.js` exactly.

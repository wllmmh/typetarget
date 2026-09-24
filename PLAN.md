# Implementation Plan — Local Chromium Live Audio Transcriber

Status tracker for the phased build described in AGENTS.md. Updated as work lands.

## Stack decisions

- **Build tool:** Vite (`@crxjs/vite-plugin` for MV3 manifest/HMR support) + TypeScript. No existing project was found (empty repo), so this is a fresh scaffold, matching AGENTS.md §"Implementation process".
- **UI:** React for popup, minimal.
- **Package manager:** npm (no lockfile present, `pnpm`/`yarn` not preferred over npm by any repo signal; npm is available in the environment).
- **Testing:** Vitest (pairs naturally with Vite, supports jsdom for content-script/DOM tests, workers).
- **ASR backend v1:** whisper.cpp WASM, vendored per the "vendor prebuilt WASM" decision — see `docs/whisper-wasm-provenance.md` for exact source/version/hashes once fetched.

## Phase status

- [x] Phase 1 — Extension skeleton (manifest, service worker, popup, build, messaging)
- [x] Phase 2 — Tab capture (source selection, chrome.tabCapture, playback restoration, start/stop)
- [x] Phase 3 — Destination selection (content script, highlighting, cross-tab messaging, safe insertion)
- [x] Phase 4 — Local ASR (engine adapter, worker-side pieces, model loading, IndexedDB cache) — real whisper.cpp binary built and verified, see docs/whisper-wasm-provenance.md
- [x] Phase 5 — Streaming (buffering, resampling, VAD, rolling inference, stabilization) — core pipeline, worker entry/controller/protocol, offscreen client, AudioWorklet PCM tap (16 kHz context) wired to the worker with pause/resume; verified in a real extension with the real model and real-time-paced audio. See HANDOFF.md for open performance findings
- [~] Phase 6 — Integration (wire capture -> pipeline -> ASR -> destination) — wired end to end in code (model loads before capture; finals routed to the destination; pause/resume; set-model); service-worker<->offscreen messaging verified in real Chrome; insertion into a real page verified in Chrome; live tab-capture (needs the toolbar-click activeTab grant) still unverified. Hand-testing found and fixed: silent model download, lost popup selections, unusable source-tab list, cross-origin isolation breaking tabCapture, a double importScripts crash, a silent audio tap, and finalized text being inserted once per content-script injection (plus stale finals bleeding across sessions). Diagnostics readout and a chunk-length slider added to the popup. Confirmed working end to end in a real browser 2026-09-22; too slow for live use — see HANDOFF.md "Performance: the actual blocker"
- [~] Phase 7 — Hardening (errors, lifecycle edge cases, perf, privacy audit, tests) — perf work started: quantized `tiny.en-q5_1` model wired in as a selectable option (unbenchmarked), the "why is `-msimd128` a no-op" question resolved at the source level (it was already on; see HANDOFF.md "Lever 4"), a benchmarking harness added (`bench/whisper-bench.html`, not yet run in a real browser). Threading (Lever 1): a threaded wasm rebuild is done (`bench/libmain-threaded.js`, gitignored, compiles clean, not yet run anywhere) but the `desktopCapture` capture-flow swap it depends on is blocked on a real UX decision, not code — see HANDOFF.md "Lever 1". `audio_ctx` (Lever 2) is the one lever nobody has touched yet. See HANDOFF.md "Performance: the actual blocker" for the full picture and what each needs before starting. **Also 2026-09-22:** the engine layer went multi-provider — `EngineRouter` dispatches by `MODEL_CATALOG[modelId].provider`, and Google's Gemini 3.5 Transcribe (Live API, `@google/genai`) is wired in as a second, opt-in, network engine end to end (model picker, API-key dialog, worker, manifest permissions, README). Typechecks/lints/builds and has 34 new passing tests, but **the actual Gemini connection is unverified** — no real API key or browser available to test it here. Groq is architected for (see HANDOFF.md "Multi-provider transcription") but not built. **2026-09-23:** first real-hardware benchmarks (Chrome now available): the bench harness works; q5_1 is ~1.3× faster with identical output; the threaded build works (~5.8× at 6 threads, ~1.8 s/call stacked with q5_1); and `audio_ctx` does *not* hang — the old "hang" was temperature-fallback blow-up on badly fitted short windows. Fitted `audio_ctx` is correct and 4–5× faster for utterances ≥~4.5 s, even single-threaded (5 s → ~1.9 s), but unreliable below that. Candidate binding in `bench/single-thread-full-opts.patch`; not shipped — awaiting a short-utterance policy decision. See HANDOFF.md "Lever 2".

## Stack decisions (v2)

- **ASR backends:** no longer just whisper.cpp — `src/domain/models.ts`'s `EngineProvider` now covers `"whisper-cpp"` (local, default) and `"gemini-live"` (Google's Gemini 3.5 Transcribe via the Live API, opt-in, requires a user-supplied key). `src/worker/engine-router.ts` dispatches between them per model. See HANDOFF.md "Multi-provider transcription" for the full design and what's still unverified.

Each phase ends with: build passes, unit tests for that phase pass, and a short note here before starting the next phase.

## Key assumptions (see also final report "Assumptions")

- Target Chrome/Chromium only; no Firefox/Safari shims.
- `chrome.tabCapture` requires the extension action to be user-invoked from the popup (per Chrome's activeTab-style gesture requirement) — start must be triggered by a popup button click, not automatically.
- Model files are fetched at runtime from a documented HTTPS source (e.g. Hugging Face's ggerganov/whisper.cpp GGML model mirror) rather than bundled in the extension package, per AGENTS.md "Model storage".
- whisper.cpp WASM glue is vendored as static assets (not npm-installed, since no npm package ships it) under `third_party/whisper-wasm/`, with provenance documented.

# Handoff — WaveType

Written for whoever (or whichever agent session) picks this up next. Read `PLAN.md` for
phase status, `docs/whisper-wasm-provenance.md` before touching anything ASR, then this
file for what is fragile, what was learned the hard way, and where the performance work
has to go.

Last updated 2026-09-22.

## Where the project actually is

- Phases 1–6 are implemented; Phase 7 (hardening) is not started. `npm test` is
  **27 files / 190 tests** passing; `npx tsc -b --noEmit`, `npx eslint .` and
  `npx vite build` are clean.
- **It works end to end in a real browser**: tab audio is captured, transcribed locally,
  and finalized text is typed into a user-picked field. That was confirmed by hand on
  2026-09-22 — indirectly, via the bug report that text was arriving *three times*,
  which it cannot do unless the whole chain works.
- Everything since commit `4188ad7` ("phase 5") is **uncommitted** in the working tree.
  Nothing in this session was committed (the user commits manually — see
  `~/.claude/CLAUDE.md`).
- It is **not usable for live transcription yet**, and that is a performance problem, not
  a wiring problem. See "Performance: the actual blocker" below — that is the section
  that matters most.

## What this session did

### Chunk-length slider (user-facing tuning knob)

A popup slider controls `maxUtteranceMs` — the cap on how long one utterance grows before
it is transcribed regardless. 3–25 s, 1 s steps, default 12 s (`src/domain/tuning.ts`,
`CHUNK_MS_*`). It is a *cap*, not a fixed interval: a pause in speech still finalizes
earlier via the VAD, which the hint text under the slider says so the number isn't
misleading.

- 25 s ceiling is deliberate: Whisper's window is 30 s and the utterance carries ~300 ms
  of pre-roll, so anything longer would be silently truncated by the encoder.
- `src/domain/tuning.ts` owns the bounds *and* `clampChunkMs`, so the slider and the
  service worker's validation cannot drift apart. Values are clamped crossing the message
  boundary and again on restore from storage.
- **Live retune**: `set-chunk-ms` threads popup → SW → offscreen → worker →
  `StreamingTranscriber.setOptions()`, so changing it mid-capture applies on the next
  audio push. Lowering it below the current utterance's age finalizes immediately rather
  than waiting out the old cap (there is a test for exactly that).
- Persisted in `storage.local` next to the model choice. The offscreen document remembers
  the value and re-applies it if the worker is created later, so a change made before
  Start is not lost.
- Popup commits are debounced 200 ms — a drag fires a change per step, and each one would
  otherwise hit storage and retune the pipeline.

### The duplicate-insertion bug (three independent causes)

The user reported finalized text being typed two or three times, and text from a
*previous* recording session appearing in the current one. Three separate causes, all
fixed, all worth remembering because each is an easy mistake to make again:

1. **`chrome.scripting.executeScript` re-runs the file on every call.** `beginSelection()`
   injects on every "Select output" click, and each run created a *fresh module scope*:
   its own `destinationSession`, its own `chrome.runtime.onMessage` listener, all of them
   still live. One `insert-text` message was therefore handled by every copy, and every
   copy still holding a live element inserted the text — once per time the user had ever
   clicked "Select output" on that page. Each copy tracked its own `insertionOffset`,
   which is why the repeats landed at odd positions instead of cleanly end to end.
   **Fixed**: the wiring moved to `src/content/bridge.ts` behind a flag on the isolated
   world's global object (shared across injections in a frame), so re-injection is a
   no-op and the existing session — including its picked destination — is reused.
   `src/content/main.ts` is now a one-line shell. Regression test in `bridge.test.ts`.
2. **`insert-text` was broadcast to every frame.** Injection is `allFrames: true` (the
   user may pick inside an iframe) but `chrome.tabs.sendMessage` was called without a
   `frameId`, so every frame received it. Frames that never picked anything replied
   `destination-unavailable`, which the service worker treats as the destination going
   away — it nulls `state.destination`. On a page like YouTube with a dozen player/ad
   iframes this fired on the first insertion and silently unbound the destination.
   **Fixed**: `insertText`/`checkAlive` address `destination.frameId`, which
   `DestinationRef` was already carrying.
3. **Queued finals outlived their capture session.** Inference is slower than real time,
   so finals pile up in `StreamingTranscriber`'s serialized inference chain, and nothing
   invalidated that chain between sessions — audio from the last session was transcribed
   and typed into the next one. **Fixed**: a `generation` counter bumped by `reset()`;
   queued work is skipped without even running inference, and in-flight results are
   discarded. The offscreen document sends `reset` at `start-capture`.

**When testing a content-script change, reload the destination page, not just the
extension.** Old injected instances live in the page.

### Left deliberately alone

- **Pressing Stop still flushes**, so backlogged finals from the session just stopped keep
  arriving for a few seconds after. That text is genuinely what was said, so dropping it
  seemed wrong — but it only *looks* wrong because the backlog exists at all, which is the
  performance problem below. If inference gets under the chunk length, the backlog (and
  this symptom) disappears.

## Performance: the actual blocker

The end goal is near-live transcription on limited hardware. Right now the extension is
roughly **2× slower than real time on a 12-core desktop**, which means "limited hardware"
is currently out of reach entirely. The arithmetic below is the whole problem.

### The cost model

Whisper's encoder always runs over a **fixed 30 s window**, padding shorter audio. So
inference cost is roughly **constant per call, independent of how much audio the call
carries**. Measured (12-core desktop, headless Chrome, `tiny.en`, same clip — full table
in `docs/whisper-wasm-provenance.md`):

| build | per inference |
| --- | --- |
| pthreads, 4 threads | ~3.3 s |
| single-threaded (what ships today) | ~13.5 s |
| single-threaded + `-msimd128` | ~12.8–14.1 s (no gain) |
| single-threaded + `audio_ctx` 768 | ~7.1 s first call, then hangs |
| single-threaded + `audio_ctx` 256 | ~2.5 s first call, then hangs |

Two numbers follow from that, and they are the only two that matter:

- **Keeping up** requires `inference_cost < chunk_length`. At 13.5 s per call the chunk
  must be ≥ ~14 s of audio just to break even, and the ceiling is 25 s.
- **Latency** ≈ `chunk_length + inference_cost` (plus backlog, which grows without bound
  once the first inequality is violated). At the 20 s chunk that keeps up, that is
  **~33 s behind the speaker**. At a 5 s chunk it falls behind ~3× and drifts forever.

So the slider cannot buy live transcription; it only lets the user choose *where* on that
curve to sit. **Near-live (≤3 s behind) needs inference down to ~1 s per call — roughly a
13× speedup.** Nothing available is a 13× lever on its own; it has to be stacked.

### Lever 1 — threads (measured 4.1×, currently blocked)

4 threads gave 13.5 s → 3.3 s. This is the largest *proven* lever and it is blocked by an
architectural conflict, not by effort:

- pthreads needs `SharedArrayBuffer`, which needs the COOP/COEP manifest keys, which make
  extension pages `crossOriginIsolated` and put them **in their own render process**.
- A `chrome.tabCapture` stream id may only be consumed **in the same render process as the
  caller** (the service worker, which stays non-isolated — verified in Chrome 153).
- So with threads, capture fails in `getUserMedia` after `getMediaStreamId` succeeds.
  Re-adding those manifest keys will silently break capture again.
- The keys are per-manifest, all-or-nothing: you cannot have one isolated page for
  inference and one non-isolated page for capture.

**The way out is to stop using `tabCapture`.** `chrome.desktopCapture` stream ids are
origin-verified rather than process-verified, so they can be consumed from an isolated
page. Cost: a system picker the user must click through, plus a permission, plus the user
can pick the wrong surface. That is a real UX regression for a real 4× — worth doing, and
it is the single highest-value structural change available.

Note the 4× was measured on a 12-core machine. On limited hardware, expect fewer usable
threads and a smaller multiple (2–3× on 4 cores is a more honest planning figure), *and* a
worse single-thread baseline to start from.

### Lever 2 — `audio_ctx` (measured 5×, currently broken after one call)

Shrinking the encoder context is the principled fix for the fixed-30 s-window cost — it is
the "stop padding" lever, and it is the biggest measured multiple of all (2.5 s at
`audio_ctx` 256 vs 13.5 s). It works exactly **once**: with both a per-request size and a
fixed 768, the *second* `full_default` call never returned, while the same build without
`audio_ctx` ran call after call at a steady ~13.5 s. It is therefore deliberately **not**
in `third_party/whisper-wasm/single-thread.patch`.

Worth retrying properly, because a working `audio_ctx` plus threads is the realistic route
to near-live (3.3 s ÷ ~5 ≈ 0.7 s per call → 2–3 s chunks → ~3 s behind):

- The hypothesis to test first: whisper.cpp sizes the encoder graph and the cross-attention
  KV cache from `n_audio_ctx` **at init**, and overriding it per call leaves the
  preallocated state mismatched for the next call. That suggests patching the value at
  *model load* (so every allocation agrees) rather than in `whisper_full_params`.
- Whatever is tried, **test repeated inferences on one context.** A single-call benchmark
  is what made this look like a free 5× in the first place.

### Lever 3 — quantized model (untried, cheapest to try)

`ggml-tiny.en-q5_1.bin` from the same Hugging Face repo — a **pure model swap**, no C++
change: add the id to `MODEL_CATALOG` (`src/domain/models.ts`) and the URL to
`MODEL_URLS` (`src/worker/model-urls.ts`). It also cuts the first-run download from ~74 MB
to ~31 MB, which is worth something on its own.

Temper the expectation: quantization mainly buys memory bandwidth, and dequantization
costs CPU. On a WASM build whose SIMD kernels appear not to be engaged (see below) it
could plausibly be a **wash or a regression**. Measure it; do not assume it.

### Lever 4 — find out why `-msimd128` does nothing (cheap, possibly large)

`-msimd128` bought no measurable time (~13 s either way). For a workload that is almost
entirely dense matmul, that is a red flag: it suggests ggml's WASM SIMD kernels are not
actually being compiled in or selected, and a missing SIMD path alone could account for a
2–4× gap against what this build should be doing. This is the **cheapest high-value
investigation** on the list — no architectural change, no UX cost:

- Check whether the built `.wasm` contains v128 opcodes at all (e.g. `wasm-objdump -x`,
  grep for `v128`/`i32x4`).
- Check whether ggml's `GGML_SIMD` / wasm-specific kernel path is active for this target
  rather than falling back to scalar C.
- It also directly determines whether Lever 3 can pay off.

### Lever 5 — a different model architecture (strategic, out of current scope)

The 30 s fixed window is a Whisper property, not an ASR property. Streaming-first models
(e.g. Moonshine-class, via ONNX Runtime Web) cost time proportional to the audio actually
given, which removes the fixed-cost-per-call problem at the root instead of working around
it. That is a backend swap, not a tune — but if Levers 1–4 stall, it is the honest answer
to "near-live on limited hardware", and the engine boundary
(`TranscriptionEngine` in `src/domain/models.ts`) was kept backend-agnostic for this.

### Recommended order

1. **Lever 4** (why no SIMD) — hours, no risk, informs everything else.
2. **Lever 3** (quantized model) — hours, no risk, may stack with 4.
3. **Lever 2** (`audio_ctx` at init) — days, needs a whisper.cpp rebuild and repeated-call
   benchmarking, biggest single multiple.
4. **Lever 1** (`desktopCapture` → threads) — days, real UX cost, largest proven multiple,
   and the one that makes limited hardware plausible.

And before claiming any real-time factor: benchmark on the actual target machine. AGENTS.md
requires this, and every number above is from one 12-core desktop.

## Fragile things and hard-won findings

- **Do not re-add the COOP/COEP manifest keys** without first replacing `tabCapture`.
  Capture breaks silently. (`manifest.config.ts`, and see Lever 1.)
- **A tabCapture MediaStream feeds only one consumer.** `pcm-stream.ts` once created its
  own 16 kHz `AudioContext` and a second source node over the captured stream; playback
  kept working and the tap got pure silence (260 batches, level 0.000). The tap now shares
  the playback context and source node and resamples in JS. Corollary: **a local
  `createMediaStreamDestination()` stream is not a valid stand-in for a tabCapture stream
  in a harness** — an earlier "two contexts, one stream" test passed and proved nothing.
- **Offscreen documents get only a subset of `chrome.runtime`** — no `getManifest`. Found
  the hard way; `src/domain/sender.ts` identifies the service worker structurally instead
  (same id, no tab, `.js` path). A fake `chrome` hid this completely.
- **A context never receives its own `chrome.runtime.sendMessage`.** A harness that sent
  popup requests from the service worker asserted nothing at all for a while.
- **`chrome.tabs.query({})` returns only `{id, audible}`** without `tabs`/host permissions,
  and tabCapture only works on tabs with an `activeTab` grant — which is why the source
  list is "tabs the popup was opened on" (`src/background/known-tabs.ts`) rather than all
  tabs. Adding `tabs` would fix the labels and leave capture broken.
- **The model must load *after* capture starts.** `getMediaStreamId` is tied to the popup's
  user gesture and a cold model download is 40–80 s. `capture-controller.ts` gets the
  stream id first, then fire-and-forgets `load-model`; audio is dropped (and counted) until
  the engine is ready.
- **One module factory per worker.** A factory per `engine.load()` re-ran `importScripts`
  and crashed with `Identifier 'EmscriptenEH' has already been declared`. `load()` also
  returns early when the model is already loaded and frees the previous context on a model
  switch (it was leaking one per load).
- **crxjs's `?script&iife` import** in `destination-controller.ts` is load-bearing and
  non-obvious — it is how the dynamically-injected content script gets built at all. Don't
  "simplify" it; read the comment there first.
- **jsdom gaps**: no `contentEditable`/`isContentEditable`, no IndexedDB. Follow the
  existing workarounds in `eligible-elements.test.ts` / `model-cache.test.ts`.
- **Rebuild `dist/` before every harness run.** One run silently tested a stale build.
- **Playwright cannot click the toolbar action**, so `activeTab` is never granted
  headlessly; harnesses need a throwaway copy of `dist/` with `host_permissions` added.
  Also `page.evaluate` does not work on extension pages (their CSP forbids eval).

## Known gaps (Phase 7)

- **Service-worker restart mid-capture loses state.** `state` in `service-worker.ts` is
  memory-only, while the offscreen document and its MediaStream may still be alive. MV3
  workers *will* be killed on real usage timescales. Highest-value correctness gap.
- **Insertion into a contenteditable steals focus.** Offered a fix (restore
  `document.activeElement` afterwards); not requested yet.
- **The popup closes whenever the user clicks into the page**, which is the normal flow.
  State persistence covers the data loss, but a `chrome.sidePanel` UI would keep the
  diagnostics and controls visible while transcribing. Offered, not requested.
- **The 0-finals symptom is believed fixed, not confirmed clean.** The user last reported
  level 0.442 with 0 finals; the next report was duplicate insertions, so finals clearly
  flow now — but no clean single-session run has been observed and described. Worth one
  deliberate confirmation pass.
- **`whisper-cpp-engine.ts`'s 30 s inference timeout cannot fire** with the synchronous
  build (noted in a comment there). Revisit if inference ever returns to a thread.
- No privacy audit pass, no benchmarking harness in the repo (all perf work so far was
  throwaway scripts).

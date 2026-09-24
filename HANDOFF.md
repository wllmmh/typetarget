# Handoff — WaveType

Written for whoever (or whichever agent session) picks this up next. Read `PLAN.md` for
phase status, `docs/whisper-wasm-provenance.md` before touching anything ASR, then this
file for what is fragile, what was learned the hard way, and where the performance work
has to go.

Last updated 2026-09-23.

## Where the project actually is

- Phases 1–6 are implemented; Phase 7 (hardening) is in progress (perf work, see below,
  plus a second transcription engine added 2026-09-22 — see "Multi-provider
  transcription"). `npm test` is **31 files / 224 tests** passing; `npx tsc -b --noEmit`,
  `npx eslint .` and `npx vite build` are clean.
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

### 2026-09-23: first real-hardware benchmarks (a browser is available now)

`/usr/bin/google-chrome` (153) and Playwright's Chromium exist on this machine now, so the
"no browser in the sandbox" caveat on everything below is lifted. Drove
`bench/whisper-bench.html` headlessly via Playwright (served by `bench/serve.mjs`), on a Ryzen
5 3600 (6C/12T — same class as the earlier 12-core numbers), with real speech (slices of
whisper.cpp's `samples/jfk.wav`, transcripts captured) as well as the harness's silence. Full
table in `docs/whisper-wasm-provenance.md`. Headlines:

- **The bench harness works** as written (one driving quirk: the synchronous production
  build blocks the page inside the Run click handler, so automation must click via a
  deferred `setTimeout`, not a normal click).
- **Lever 3 measured: `tiny.en-q5_1` is ~1.3× faster** than `tiny.en` (single-threaded
  ~10.4 s vs ~13.4 s on 11 s of speech; ~9.7 vs ~12.8 s on silence), identical transcript,
  2.4× smaller download. Not promoted to default yet — that is a product call; recommended.
- **Lever 1 measured: the threaded build (`bench/libmain-threaded.js`) works** — correct
  transcripts, stable over repeated calls, scaling near-linearly to the 6 physical cores:
  13.8 s → 6.5 s (×2) → 3.4 s (×4) → 2.3 s (×6), no further gain at ×8 (SMT). Stacked with
  q5_1: **~1.8 s** at ×6. Still blocked on the `desktopCapture` UX decision below, not code.
- **Lever 2: the "hang" was a misdiagnosis.** `audio_ctx` works on repeated calls on both
  builds. The real failure mode is decoder degeneration + 5× temperature fallback when the
  shrunken window fits the audio badly — 64–103 s per call single-threaded, which looks
  exactly like a hang. Details, and the length-dependent policy it implies, in "Lever 2".
  The single-threaded build + q5_1 + fitted `audio_ctx` runs a **5 s utterance in ~1.9 s**
  — faster than real time with *no* threads, i.e. without touching the capture flow.
- **New: `bench/single-thread-full-opts.patch`** — the shipping `single-thread.patch` plus a
  second binding, `full_opts(index, audio, lang, nthreads, translate, audio_ctx,
  single_segment, no_timestamps, temperature_inc, max_tokens)` (also sets
  `no_context = true`). This is what the audio_ctx numbers were measured with; it is a
  candidate replacement for `third_party/whisper-wasm/single-thread.patch`, not applied to
  the vendored build yet. (The same binding was also added to the threaded checkout at
  `/home/will/voicewrite-toolchain/whisper.cpp`, whose `build-em` output therefore no longer
  matches `bench/libmain-threaded.js` exactly; the single-threaded build lives in a git
  worktree at `/home/will/voicewrite-toolchain/whisper.cpp-st`.)
- The Playwright driver scripts were throwaway (scratchpad) and not committed; the method is
  above — Playwright from the npx cache, `executablePath: /usr/bin/google-chrome`, model
  requests to huggingface.co fulfilled from local copies via `page.route`. Note that
  `page.route` does **not** see the pthread workers' fetch of the glue script, so a
  threaded glue build under test must actually be on disk under the served root.

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

### Performance investigation (2026-09-22)

Picked up directly from "Performance: the actual blocker" below, in the order it
recommended. No sandbox tooling for the heavy levers (no `emsdk`/`cmake`/`ninja`/browser
binary here), so this session did what's verifiable without them and left what isn't
clearly marked:

- **Lever 4 (SIMD) resolved, no rebuild needed** — read ggml's actual CMake source at the
  pinned whisper.cpp commit instead of guessing from the compiled binary. `-msimd128` is
  already unconditionally compiled into `ggml-cpu` under Emscripten; the "no gain"
  reading from the previous session's experiment was because that session's flag went
  into the *example's* `LINK_FLAGS` (link-stage only, can't affect already-compiled
  object files) rather than a compile flag. Full citations and reasoning in "Lever 4"
  below. Net: not a real lever, nothing to chase here.
- **Lever 3 (quantized model) implemented** — `tiny.en-q5_1` added as a selectable model
  (not the default). Verified the Hugging Face file exists and its exact size, verified
  `npx tsc -b --noEmit` / `npx eslint .` / `npx vitest run` (190 tests) / `npx vite build`
  all still pass with it wired in. **Not benchmarked** — no browser available in this
  sandbox to actually run it.
- **Added `bench/whisper-bench.html`** — closes the "no benchmarking harness in the repo"
  gap. Loads a glue build directly in a plain page (same technique the provenance doc's
  own manual verification used), times repeated `full_default` calls on synthetic silence,
  reports steady-state mean; can now load either the production single-threaded build or
  the experimental threaded one below, with an `nthreads` control (`bench/serve.mjs` — a
  zero-dependency Node static server, added after first writing this as a Python script
  and being asked why that was necessary in a Node project; it wasn't — adds the COOP/COEP
  headers the threaded one needs). Written to answer the Lever 3 question
  above and reused immediately for Lever 1 below, instead of a new throwaway script each
  time. **I could not run it myself** (no browser binary in this environment) — it is
  untested. Load it in real Chrome before trusting its output.
- **Lever 1 (threading via `desktopCapture`) — started at the user's explicit go-ahead,
  mid-way.** Set up a full `emsdk`+`cmake`+`ninja` toolchain from scratch (none were
  present, none needed root — see `bench/README.md`) and rebuilt whisper.wasm *with*
  pthreads from the exact commit the production build is pinned to, changing exactly one
  thing from stock upstream (added the existing MV3-CSP flag; left threading and the C++
  untouched). It compiles clean and contains the right markers
  (`SharedArrayBuffer`/`Atomics`/`pthread`/Embind), but **that's compile-time evidence
  only** — no browser here to actually run it. The `desktopCapture` manifest/capture-code
  swap itself was deliberately not started: researching it (Chrome docs + a filed
  Chromium extensions-samples issue) surfaced that the OS picker can't be pre-targeted at
  a specific tab, so WaveType's own tab dropdown and the picker would both be in the loop
  if this ships as a literal API swap — a real product decision, not just an
  implementation detail. Full findings, the rebuild recipe, and the open UX question are
  in "Lever 1" below.
- **Lever 2 (`audio_ctx`) not attempted** this session (the toolchain time went to Lever 1
  instead, at the user's direction) — but the toolchain built for Lever 1 is sitting at
  `/home/will/voicewrite-toolchain/` on this machine, outside the repo, so this no longer
  needs a from-scratch setup for whoever picks it up next.

### Multi-provider transcription: Gemini Live added, Groq architected for

WaveType went from one hardcoded engine (whisper.cpp) to a real multi-provider
architecture, plus a second, real engine: Google's Gemini 3.5 Transcribe via the Live
API. This was scoped and approved as a plan before implementation — the plan file
(written to `/home/will/.claude/plans/crispy-discovering-rocket.md` during the planning
session, not part of this repo) has the full design reasoning; this is the "what
actually landed and what's still open" summary.

**Architecture** (`src/worker/engine-router.ts`, `src/worker/gemini-live-engine.ts`):
`EngineRouter` dispatches by `MODEL_CATALOG[modelId].provider`
(`src/domain/models.ts`'s new `EngineProvider` type: `"whisper-cpp" | "gemini-live"`),
presenting one object that satisfies both shapes `asr-worker-controller.ts` depends on
(`TranscriptionEngine` for status; `StreamingTranscriber`'s narrow streaming shape for
audio-in/event-out) — **the controller itself needed only one small, additive change**
(a `set-api-key` case, mirroring `set-chunk-ms`'s pattern exactly), not a redesign.
`GeminiLiveEngine` is the interesting piece: it implements *both* shapes in one class,
since a persistent WebSocket with server-side turn detection doesn't fit the
"transcribe(chunk) -> text" model whisper.cpp uses at all. It reuses
`TranscriptStabilizer` completely unchanged — Gemini's `interimInputTranscription` /
`inputTranscription`+`turnComplete` map directly onto the stabilizer's existing
partial/final contract, which turned out to already be shaped for exactly this (it was
built for rolling-window whisper hypotheses, but the contract itself — "interim text for
one utterance, replaced by exactly one final" — doesn't care what drives it).

**Dependency:** `@google/genai` v2.24.0 (Google's official SDK), not a hand-rolled
WebSocket client. This was a deliberate change of plan mid-session: scraped
documentation for this (weeks-old) API gave inconsistent model names across sources — a
real hallucination signal — so the actual npm tarball was downloaded and its shipped
`.d.ts` read directly instead of trusting prose docs. It has a genuine browser build
(`package.json`'s `exports["."].browser` → `dist/web/index.mjs`, confirmed to import
nothing but itself and `p-retry` — no Node built-ins, no `ws`), which Vite resolves
automatically; the worker's built bundle grew from ~11 KB to ~427 KB minified as a
result, confirmed to build clean with no unguarded Node-isms (checked: the only
`Buffer` reference in the built bundle is behind a `typeof globalThis.Buffer !== "undefined"`
guard, from an SDK code path — file uploads — this project doesn't use).

**API keys** (`src/domain/api-key.ts`): keyed by provider (`ApiKeyProvider =
"gemini-live" | "groq"`), not hardcoded to Gemini — Groq will need its own the moment
it's built, so the plumbing (storage, messages, the popup dialog) was written for N
providers from the start rather than done once for Gemini and reshaped later. Stored in
`chrome.storage.local` under `apiKeys` (no existing precedent for secrets in this repo;
this is the standard place other extensions use, and MV3 has no better option without
hand-rolled encryption, which would be over-engineering here). Never round-tripped back
to the popup as a value — `PublicAppState.apiKeyProviders` says only which providers
have one set. The popup's "API Keys" button opens a native `<dialog>` (per explicit
direction — not the inline-field-that-appears-when-selected design originally proposed)
with one masked field per provider, including Groq's, even though no engine exists yet
to use a Groq key — so a key pasted in early isn't lost once Groq ships.

**Groq — architected for, not built.** `EngineProvider` deliberately does *not* have a
`"groq"` member yet (an unreachable union member just invites a dead `case` or false
confidence); adding it later is one literal in `domain/models.ts`, one new
`src/worker/groq-engine.ts` implementing plain `TranscriptionEngine` (Groq's API is
POST-per-chunk, the same discrete shape whisper.cpp already uses — no engine-router or
controller changes needed, unlike Gemini), one new `MODEL_CATALOG` entry, and one new
`EngineRouter` case. The API key plumbing already supports it (`ApiKeyProvider` includes
`"groq"` today; the popup dialog already has the field). Not implemented because there's
no confirmed Groq transcription model id/endpoint to build against yet — same
verify-before-building bar as everything else here.

**Bug found in first hand test (2026-09-23), fixed:** a key saved while idle (the normal
flow) never reached the engine — the service worker only forwarded keys to a *running*
session, and `startCapture` re-sent the chunk length but not the keys, so a fresh offscreen
document loaded Gemini with no key ("Set a Gemini API key first" despite a saved key).
`CaptureController.start` now sends saved keys after `start-capture` and before
`load-model` (the engine reads its key at load). Regression test in
`capture-controller.test.ts`.

**Second bug, same day — connected but never produced a final; fixed and verified against
the real API.** Probed the live service directly (Node + the SDK, `jfk.wav` streamed at
real-time pace, every server message logged) instead of trusting the design assumptions:

- The server **never sends `turnComplete`** for transcription. Each utterance ends with a
  bare `inputTranscription` (the final), then `generationComplete`, then
  `voiceActivity: ACTIVITY_END`. The engine only emitted finals on `turnComplete`, so it
  emitted none.
- **Server-side turn detection lost most continuous speech**: after each detected end,
  speech was ignored for seconds (whole sentences missing, deterministically, with every
  `activityHandling`/`turnCoverage`/`silenceDurationMs` variant tried).
- What worked, losslessly: `automaticActivityDetection: { disabled: true }` +
  `turnCoverage: TURN_INCLUDES_ALL_INPUT`, client-sent `activityEnd` at boundaries, and the
  next `activityStart` sent **only after the server's `ACTIVITY_END` acknowledgement** — one
  sent alongside the `activityEnd` is silently dropped (every other utterance lost). Audio
  sent while awaiting the acknowledgement is folded into the next utterance.
- The SDK's `.d.ts` names the field `voiceActivity.voiceActivityType`; v2.24.0 actually
  delivers `type`. The engine reads either.
- The bare `gemini-3.5-transcribe-live` model id works (the "`models/...` form?" question
  below is answered).

`GeminiLiveEngine` now marks boundaries itself: at a local `EnergyVad` pause, or at the
chunk-length slider's cap (which was a no-op for Gemini before — the popup's hint text
already described this behavior). A server-side close/error now surfaces as an error event
and status instead of silently dropping all later audio. Verified by running the real
engine class against the real API (via `vite-node`): 9 finals over two passes of the clip,
each ~0.5–1 s after the phrase ended. **Known imperfection:** a boundary forced by the cap
mid-phrase loses the word straddling it (reproducibly "fellow" at a 3 s cap); boundaries
at pauses don't. A longer chunk setting makes cap cuts rarer; deferring a cap cut to the
next low-energy frame would be the real fix. Not yet tested in the extension itself
(popup → offscreen → worker → insertion) after this change.

**What's verified vs. not:**

- Verified: the whole thing typechecks, lints, and builds
  (`npx tsc -b --noEmit` / `npx eslint .` / `npx vite build`); the existing whisper path
  and its 190 pre-existing tests are unaffected. 34 new tests: 30 in four new files
  (`gemini-live-engine.test.ts` covering connection lifecycle, PCM encoding, partial/
  final event wiring, and flush/reset semantics via a fake session — no real network;
  `engine-router.test.ts` covering provider dispatch/switching; `pcm16-encode.test.ts`;
  `api-key.test.ts`), plus 4 more added to two existing files
  (`asr-worker-controller.test.ts`'s new `set-api-key` case, `persisted-state.test.ts`'s
  new storage key).
- **Not verified: anything that requires a real Gemini API key, a real browser, or a
  real network connection.** Same sandbox limitation as this session's wasm-threading
  work (no browser binary available here). Two protocol details are flagged rather than
  guessed and should be the first things checked on a real test:
  - Whether `client.live.connect({model: "gemini-3.5-transcribe-live", ...})` wants that
    bare id (matches the SDK's own doc-comment example convention) or a fully-qualified
    `"models/..."` form (the field's own doc comment says "fully qualified name," which
    conflicts with the example — genuinely ambiguous from the types alone).
  - `LiveConnectConfig`/`AudioTranscriptionConfig` are marked `@experimental` in the
    SDK's own doc comments — this is pre-GA API surface Google could still change.
  - Real Gemini free-tier rate limits are unconfirmed (pricing page didn't specify
    numbers when checked) — no bespoke rate-limit handling was built around unconfirmed
    numbers; errors currently surface generically as an `EngineStatus: "error"`.
- The privacy-facing copy changed to match: manifest `description`, a new `README.md`
  (didn't exist before — the manifest's own comments already referenced README
  "Permissions"/"Privacy" sections that had never been written), and a new
  `host_permissions: ["https://generativelanguage.googleapis.com/*"]` — a real, visible
  permission grant on next update, present only because the Gemini engine needs it.

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

### Lever 1 — threads (**measured working 2026-09-23: ~5.8× at 6 threads**; blocked only on the UX decision)

2026-09-23: `bench/libmain-threaded.js` runs correctly in real Chrome (crossOriginIsolated via
`bench/serve.mjs`): `tiny.en` 13.8 s → 2.3 s at 6 threads, q5_1 → 1.8 s, transcripts identical,
stable over repeated calls. The "compiled, not tested" caveats below are resolved; the
`desktopCapture` UX question is not.

4 threads gave 13.5 s → 3.3 s in the earlier session's measurement. This is the largest
*proven* lever, and it's blocked by an architectural conflict, not by effort:

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
page.

#### What this session did on it

Started this at the user's explicit go-ahead (a real permission/UX change, so it needed
one — see chat). Split into what's independently verifiable (the wasm rebuild) and what
needs a real browser this sandbox doesn't have (everything downstream of that).

**Threaded wasm rebuild — done, artifact produced, not yet run anywhere.** No
`emsdk`/`cmake`/`ninja` were available in this sandbox; all three were fetched and set up
without root (official prebuilt binaries, no `apt`/`pip`) — see `bench/README.md` for the
exact recipe, versions, and a rebuild caveat found along the way (ggml's WASM-SIMD
quantized kernels are dead code for this project's build regardless of threading — see
Lever 3 above, discovered while doing this). The only change from stock upstream is adding
`-s DYNAMIC_EXECUTION=0` (the existing MV3-CSP requirement) to the example's `LINK_FLAGS`;
`USE_PTHREADS=1` and `examples/whisper.wasm/emscripten.cpp` stay exactly as upstream ships
them, since the patched synchronous/`n_threads=1` version
(`third_party/whisper-wasm/single-thread.patch`) exists specifically to work around the
*no*-pthreads build. Build succeeded, produced `bench/libmain-threaded.js` (gitignored,
not committed — rebuild it yourself, see `bench/README.md`), and it contains the expected
`SharedArrayBuffer`/`Atomics`/`pthread`/Embind markers. **That is compile-time evidence
only.** It has not been run — no browser binary exists in this sandbox, and it can't run
under plain Node either (checked: the build has no `ENVIRONMENT_IS_NODE` code path at all,
so it's Web+Worker-only; making it Node-runnable would need a different, non-representative
build). `bench/whisper-bench.html` now has a glue-build selector and an `nthreads` field
specifically to test this once someone has a real Chrome available — that is the very next
step before anything else on this lever, because a build that compiles is not a build that
works, and this genuinely might not (see "Fragile things" for how many production-only
surprises this project has already hit: silent audio taps, CSP eval failures the hosted
build didn't reveal, an `audio_ctx` fix that worked once then hung forever).

**`desktopCapture` UX — scoped, not implemented; genuinely changes the interaction, not
just a permission line.** Checked Chrome's actual behavior (docs + a filed Chromium
extensions-samples issue, not memory) rather than assuming:

- `chooseDesktopMedia` always shows an interactive OS-level picker. There is no way to
  hand it a known tab id and get a streamId back silently — the user manually re-picks a
  tab (or window/screen) every time, even though WaveType's own popup already has a
  tab dropdown (`known-tabs.ts`) they just used to start capture.
- `targetTab` does **not** pre-select or filter the picker to that tab. Per the type
  definition (`@types/chrome`) it only restricts *which tab's frames may later redeem the
  resulting streamId* via `getUserMedia` — a consumption-scope guard, not a selection
  shortcut.
- In MV3, calling `chooseDesktopMedia` from the service worker **without** `targetTab`
  throws ("A target tab is required when called from a service worker context" —
  `github.com/GoogleChrome/chrome-extensions-samples/issues/1073`, filed against exactly
  this transition). So `targetTab` is mandatory here, but — per the point above — it buys
  scoping, not UX.
- Net effect: the existing "pick a source tab from WaveType's dropdown" popup flow and the
  OS picker are **both** in the loop if this ships as a literal `tabCapture`→
  `desktopCapture` swap — the user picks the tab twice, once in each UI. That's not a
  minor cost; it's confusing enough to be worth a real product decision, not just an
  implementation detail. Two honest options: (a) ship the redundancy as-is and accept the
  UX hit for the speed, or (b) drop WaveType's own tab dropdown entirely and let the OS
  picker be the only tab-selection UI, which is a bigger change to `known-tabs.ts` and the
  popup than "swap one API for another." **Not decided yet — ask the user which, with the
  above laid out plainly, before writing manifest/capture code.** (Sources array behavior
  for filtering the picker to tabs-only, e.g. `["tab", "audio"]`, is also not confirmed
  from a primary source — Chrome's own reference page doesn't spell it out. Would need
  testing in a real picker to confirm, same as everything else on this lever.)

Note the 4× was measured on a 12-core machine. On limited hardware, expect fewer usable
threads and a smaller multiple (2–3× on 4 cores is a more honest planning figure), *and* a
worse single-thread baseline to start from.

### Lever 2 — `audio_ctx` (**re-measured 2026-09-23: works; the "hang" was fallback blow-up; needs a length-dependent policy**)

What the 2026-09-23 re-test found (single-threaded + threaded, q5_1 and tiny.en, jfk.wav
slices, ≥2 repeated calls each; `audio_ctx` is in 20 ms encoder frames, 1500 = 30 s):

- **No hang, on either build.** Repeated calls, and changing `audio_ctx` between calls on one
  context, all return. The init-time-allocation hypothesis below is moot: the KV caches are
  sized for the maximum at init and a smaller per-call value fits inside them.
- **The window must fit the audio, with a modest margin.** Audio longer than the window
  spills into extra windows and hallucinates; audio in a window with almost no slack (5 s in
  5.12 s) degenerates.
- **Utterances ≥ ~4.5 s: `audio_ctx = ceil((seconds + 0.5) * 50 / 32) * 32` was correct in
  every case tried** (margins 0.25–1 s all fine), and 4–5× faster: single-threaded q5_1, 5 s
  → 1.9 s, 8 s → 2.9 s (vs ~9.5 s at full context); threaded ×6 q5_1, 5 s → 0.4 s.
- **Utterances ≤ ~4 s: no margin was reliably correct** — depending on clip and margin the
  output repeated itself, turned to garbage, or came back **empty** (speech silently lost).
  Not monotonic in the margin, so not tunable away. Full context stays correct here.
- **The "hang"**: a degenerate decode triggers temperature fallback (5 retries, each up to
  ~224 tokens): 64–103 s per call single-threaded. The earlier per-request variant used a
  256 floor, which lands every short utterance in exactly this regime.
- `max_tokens ≈ 5/s + 8` + `temperature_inc = 0` bounds that worst case to ~1–2 s
  single-threaded, and changed no transcript in the ≥4.5 s cases — but does not make short
  clips correct. `single_segment`/`no_timestamps` (what whisper.cpp's `stream` example
  uses) made results *worse* and should not be used.
- Evidence limit: one 11 s clip, one speaker, clean audio. Test on varied real tab audio
  before trusting the ≥4.5 s threshold.

Implied policy if shipped: fitted `audio_ctx` (+ the token cap as a safety bound) for
utterances ≥ ~4.5 s, full context below that. The catch: short VAD utterances then still cost
~9.5 s single-threaded, so this pays off fully only if the pipeline avoids short finals
(e.g. a minimum utterance length before a VAD pause may finalize) — a streaming-behavior
change, not just an engine one. Undecided; see "Recommended order".

Original (2026-09-22 and earlier) notes, kept for history:

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

### Lever 3 — quantized model (**implemented 2026-09-22; measured 2026-09-23: ~1.3×, same transcript**)

`tiny.en-q5_1` (`ggml-tiny.en-q5_1.bin`, verified on Hugging Face at 32,166,155 bytes ≈
31 MB, vs. 77,704,715 bytes for `tiny.en`) is now a selectable model: `ModelId` in
`src/domain/models.ts`, `MODEL_CATALOG` (same file), `MODEL_URLS`
(`src/worker/model-urls.ts`), `MODEL_FILENAME_IN_FS` (`src/worker/whisper-cpp-engine.ts`).
Pure model swap, no C++ change, no default change — `tiny.en` stays `DEFAULT_MODEL` until
this is measured. The popup dropdown picks it up automatically (it renders from
`MODEL_CATALOG`). `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (190 tests) and
`npx vite build` all pass with it added.

Updated expectation, revised twice this session — first up, then back down:

- ggml vendors hand-written `__wasm_simd128__` quantized dot-product kernels
  (`ggml/src/ggml-cpu/arch/wasm/quants.c`), which looked like a real compute-path win,
  not just a smaller download.
- **Then an actual from-source rebuild (below, done for Lever 1) showed that file is
  dead code for this project's build.** It's gated on
  `CMAKE_SYSTEM_PROCESSOR MATCHES "wasm"`, and Emscripten's own CMake toolchain file
  (`emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake`) sets
  `CMAKE_SYSTEM_PROCESSOR` to the literal string `"x86"` by default — not `"wasm"` —
  so every `emcmake cmake` invocation with this project's flags falls into ggml's
  `else()` branch (`ggml-cpu/CMakeLists.txt`: "Unknown CPU architecture. Falling back
  to generic implementations.", `-DGGML_CPU_GENERIC`). Confirmed directly in this
  session's build log and by grepping the actual compiled object list (`quants.c.o`
  from the generic path, not `arch/wasm/quants.c.o`). This is true of the **existing
  vendored `tiny.en` build too**, not something this session's changes caused — nobody
  passed `-DEMSCRIPTEN_SYSTEM_PROCESSOR=wasm` before, and the doc's own rebuild recipe
  doesn't either.
- So quantized inference here runs through the portable/scalar quant kernels, not
  SIMD ones. This *doesn't* revive the original "could be a wash or a regression"
  caution — it's now directly evidenced, not speculative. The `-msimd128` **F32** path
  (Lever 4, `simd-mappings.h`) is unaffected by this and still applies to both models'
  activations; only the weight-quantization dot product loses its SIMD kernel.

**Still needs benchmarking on real hardware**, which this sandbox cannot do (no browser
binary available here; see `bench/whisper-bench.html`, added this session and unverified
by me for exactly that reason). Run it and load both `tiny.en` and `tiny.en-q5_1` back to
back for a same-machine, same-clip A/B. If someone wants the wasm-SIMD quant kernels for
real, passing `-DEMSCRIPTEN_SYSTEM_PROCESSOR=wasm` to `emcmake cmake` and rebuilding is
untried and might be worth a follow-up — no idea yet whether ggml's wasm-arch code
actually expects/handles that correctly end to end, since it's evidently never been
exercised by this project.

### Lever 4 — why `-msimd128` did nothing (**resolved 2026-09-22: it was a measurement artifact, not a missing codepath**)

Checked against ggml's actual build config rather than the compiled binary (no
`wasm-objdump`/`emsdk` available in this sandbox to inspect the vendored `.wasm`
directly, so this is source-level, not binary-level, confirmation — re-verify against
the binary if that tooling is ever available):

- `ggml/src/ggml-cpu/CMakeLists.txt` (confirmed at the exact pinned whisper.cpp commit,
  `5670d5c0bbcb148feabef84400a07cfca9aa3b30`) sets
  `set_target_properties(${GGML_CPU_NAME} PROPERTIES COMPILE_FLAGS "-msimd128")`
  unconditionally whenever `EMSCRIPTEN` is set — i.e. **every** Emscripten build of
  ggml's CPU backend already compiles with `-msimd128`, including the plain
  `emcmake cmake` build this project vendors. `ggml/src/ggml-cpu/simd-mappings.h` then
  gates its WASM F32 SIMD path on `defined(__wasm_simd128__)`, which is exactly the
  macro `-msimd128` defines — so that path is live in the vendored build with no extra
  flags needed.
- The `-msimd128` the earlier session added and measured "no gain" from went into the
  **`whisper.wasm` example's `LINK_FLAGS`** (`examples/whisper.wasm/CMakeLists.txt`).
  `LINK_FLAGS` only affects the link step; it cannot change how `ggml-cpu`'s `.c`/`.cpp`
  files were compiled, since those object files were already built (with `-msimd128`,
  per the point above) before the link step runs. Adding it there is a no-op by
  construction. **Both rows of the earlier benchmark table already had WASM SIMD
  active** — the experiment never had a true scalar-only baseline to compare against,
  so "no gain" measured "flag already redundant," not "SIMD doesn't help here."
- Conclusion: there is no missing 2–4× hiding behind a disabled SIMD path. Drop this as
  a lever — the ~13.5 s single-threaded baseline already reflects SIMD-enabled ggml.
  The gap to native speed is WASM's general overhead plus lack of threads, not a missing
  compile flag. Re-focus on Levers 1–2.

### Lever 5 — a different model architecture (strategic, out of current scope)

The 30 s fixed window is a Whisper property, not an ASR property. Streaming-first models
(e.g. Moonshine-class, via ONNX Runtime Web) cost time proportional to the audio actually
given, which removes the fixed-cost-per-call problem at the root instead of working around
it. That is a backend swap, not a tune — but if Levers 1–4 stall, it is the honest answer
to "near-live on limited hardware", and the engine boundary
(`TranscriptionEngine` in `src/domain/models.ts`) was kept backend-agnostic for this.

### Recommended order

1. ~~**Lever 4** (why no SIMD)~~ — resolved 2026-09-22, no code change: SIMD was already
   on, the earlier "no gain" reading was a no-op flag placement. Nothing to build.
2. **Lever 3** (quantized model) — measured 2026-09-23: ~1.3× faster, identical transcript.
   Next: decide whether to promote `tiny.en-q5_1` to `DEFAULT_MODEL` (recommended).
3. **Lever 2** (`audio_ctx`) — **now the best shippable lever**: works without threads and
   without the capture-flow change. Next: (a) decide the short-utterance policy (see
   "Lever 2"), (b) rebuild the vendored `libmain.js` from `bench/single-thread-full-opts.patch`,
   (c) have `WhisperCppEngine.transcribe` pick `audio_ctx`/`max_tokens` from the audio length,
   (d) validate on varied real tab audio. Original note: days, needs a whisper.cpp rebuild and repeated-call
   benchmarking, biggest single multiple. Not attempted this session (effort went to Lever 1
   instead, at the user's direction). The toolchain this session set up for Lever 1
   (`emsdk`/`cmake`/`ninja`, none of which were available in this sandbox until now — see
   `bench/README.md` for exact versions and the no-root install method) is sitting at
   `/home/will/voicewrite-toolchain/` on this machine, outside the repo, ready to reuse for
   this too rather than redone from scratch.
4. **Lever 1** (`desktopCapture` → threads) — days, real UX cost. Started 2026-09-22 at the
   user's explicit go-ahead: the threaded wasm rebuild is done (artifact at
   `bench/libmain-threaded.js`, gitignored, rebuild recipe in `bench/README.md`), but it is
   **compiled, not tested** — no browser available in this sandbox to actually run it or the
   `desktopCapture` swap. The manifest/capture-flow code change itself was deliberately not
   started: it turned out to carry a real, unresolved UX question (the picker can't be
   pre-targeted at a specific tab, so WaveType's own tab dropdown and the OS picker would
   both be in the loop — see "Lever 1" above for the full finding), which needs a product
   decision before writing that code, not just an engineering one.

And before claiming any real-time factor: benchmark on the actual target machine. AGENTS.md
requires this, and every number above except this session's rebuild succeeding is either
from one 12-core desktop measured by an earlier session, or not yet measured at all.

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
- No privacy audit pass.
- ~~Benchmarking harness never run~~ — run 2026-09-23 in real Chrome; it works (see top).

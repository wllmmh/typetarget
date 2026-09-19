# Handoff — continuing on the recording machine

Written at the end of a session that built Phases 1–4 of the plan in `PLAN.md`.
Read `PLAN.md` first for phase status, then this file for what to do *next* and
what's fragile.

## State of the repo right now

- All of Phases 1–4 (extension skeleton, tab capture, destination selection,
  ASR engine layer) are implemented, typechecked, linted, built, and covered by
  99 passing unit tests (`npm test`).
- Phase 2–4 work is committed (`700e189`) and `origin` is
  `github.com/williammh/soundwave-field`. Since then, uncommitted: manifest COOP/COEP,
  the whisper loader/engine fixes (+ tests), and these doc updates.
- Extension has never been loaded into a real Chromium browser or click-tested.
  Everything is verified via `npm test` + `npm run build` only.

## Immediate next steps (in order)

1. `cd soundwave-field && npm install` (fresh clone/machine won't have `node_modules`).
2. Review the working tree diff (`git status`, `git diff`) — it's the accumulated
   Phase 2–4 work. Commit it. Suggested message: something like "Implement tab
   capture, destination selection, and local ASR engine layer (Phases 2-4)" — but
   defer to the user's own commit message conventions if they have one.
3. Set up a git remote and push, if the user wants this backed up / shared before
   continuing on the recording machine.
4. Run the full verification loop to confirm nothing broke in transit:
   ```
   npx tsc -b --noEmit && npx eslint src --ext .ts,.tsx && npm test && npx vite build
   ```
5. ~~Get the real whisper.cpp WASM binary~~ — done; see "The whisper.cpp binary" below.

## What's NOT done yet (Phase 5, 6, 7 — not started)

- **Phase 5 (Streaming)**: no rolling-window buffering, no AudioWorklet wiring the
  resampler/VAD/stabilizer into a live pipeline, no ASR Worker entry point
  (`src/worker/main.ts` doesn't exist yet). All the *pieces* exist and are tested in
  isolation (`resample.ts`, `energy-vad.ts`, `stabilizer.ts`, `whisper-cpp-engine.ts`)
  but nothing wires them together into a running pipeline yet.
- **Phase 6 (Integration)**: capture (Phase 2) and destination (Phase 3) are each
  wired end-to-end and independently provable, but neither is connected to ASR yet.
  The offscreen document (`src/offscreen/main.ts`, `capture.ts`) currently only does
  capture + playback restoration — it doesn't yet feed audio into a resampler/VAD/ASR
  worker or forward transcript events to the service worker for destination
  insertion. That whole wiring path is Phase 6's job.
- **Phase 7 (Hardening)**: not started at all — no perf benchmarking, no
  service-worker-restart-mid-capture recovery (see the comment in
  `src/background/service-worker.ts` — capture state currently lives only in memory
  and is lost if the SW restarts), no diagnostics panel.

## The whisper.cpp binary — built from source, verified in the extension (2026-09-18)

`third_party/whisper-wasm/libmain.js` is **our own Emscripten build with
`-s DYNAMIC_EXECUTION=0`** (gitignored; recipe, commit and checksum in
`docs/whisper-wasm-provenance.md`). The hosted demo build does not work: Embind's
`new Function` violates the MV3 extension CSP. The rebuilt file was verified by loading
the built extension into Chrome, starting the ASR worker from an extension page and
transcribing `jfk.wav` with the real `tiny.en` model. **Read the provenance doc
before touching ASR** — key points:

- The build is a classic global-`Module` script (no `libmain` factory);
  `print`/`printErr` are read once at startup, so they are load-time overrides.
- **Phase 5 constraint:** pthreads are spawned from the worker's own URL as classic
  workers named `em-pthread`. The ASR worker entry (`src/worker/main.ts`) must be an
  IIFE bundle and, when `self.name === "em-pthread"`, only `importScripts` the glue.
- SharedArrayBuffer comes from the manifest's COOP/COEP keys (`manifest.config.ts`) —
  **no browser launch flag needed**. Confirmed in the real extension (extension page +
  worker); the offscreen document itself has not been exercised yet.
- The verification harnesses were throwaways, not in the repo; unit tests still use a
  fake module. Consider a repo dev script if this needs repeating. (Playwright's
  `page.evaluate` doesn't work on extension pages — their CSP forbids eval — so the
  harness was a plain script loaded from an HTML file dropped in `dist/`.)

## Other things worth knowing before continuing

- **crxjs's `?script&iife` import mechanism** (`src/background/destination-controller.ts`)
  is load-bearing and non-obvious — it's how the destination content script gets
  bundled even though it's never declared in `manifest.content_scripts` (it's
  injected dynamically via `chrome.scripting.executeScript`). If a future edit
  breaks that import or removes the `@crxjs/vite-plugin/client` type reference in
  `src/vite-env.d.ts`, the content script will either fail to build or fail to
  resolve at runtime. Don't "simplify" this without understanding why it's there —
  see the comment in `destination-controller.ts` and the research trail in this
  session's transcript if something breaks.
- **jsdom gaps**: jsdom doesn't implement `HTMLElement.contentEditable`/
  `isContentEditable` or `IndexedDB` at all. Tests work around this (attribute checks
  instead of the property; `fake-indexeddb` package). If you add new contenteditable-
  or IndexedDB-related tests, follow the existing pattern in
  `eligible-elements.test.ts` / `model-cache.test.ts` rather than rediscovering this.
- **Service worker capture state is not restart-safe.** If Chrome kills and restarts
  the service worker mid-capture, `src/background/service-worker.ts`'s in-memory
  `state` is lost even though the offscreen document (and its actual MediaStream) may
  still be alive. This is flagged in a code comment and in Phase 2's report as a known
  Phase 7 gap — worth fixing before this ships for real extended use, since MV3
  service workers *will* get killed on real usage timescales.
- **Performance numbers are all unbenchmarked placeholders**: the 30s inference
  timeout, `nthreads=4` in `full_default`, and model size figures in UI copy are
  documented as placeholders, not measured values. AGENTS.md explicitly says not to
  claim a real-time factor until benchmarked — don't let placeholder numbers migrate
  into the README's "Definition of done" claims without actually measuring on the
  recording machine.
- **No real-browser testing has happened at all yet** (Phase 2 and Phase 3 were each
  offered for a manual load-test checkpoint during the session and the user chose to
  keep building instead both times). The very first real "does this actually work in
  Chrome" moment is still ahead — expect to find real bugs there that unit tests
  couldn't catch (e.g. actual `chrome.tabCapture` permission/gesture edge cases, the
  real offscreen document lifecycle, actual destination-picking on a real page).

## Recommended order of work on the new machine

1. Commit + push this session's work (see "Immediate next steps").
2. (Done) real whisper.cpp binary obtained and validated.
3. Load the unpacked extension (`npm run build`, then load `dist/` in
   `chrome://extensions`) and manually walk through Phase 2 (tab capture + playback
   restoration) and Phase 3 (destination selection + insertion) for the first time —
   these have never been tested in a real browser.
4. Build Phase 5 (streaming pipeline: rolling window, AudioWorklet, VAD-gated
   inference scheduling, the ASR Worker entry point).
5. Build Phase 6 (wire capture → pipeline → ASR → destination insertion end-to-end).
6. Only then move to Phase 7 hardening and the performance benchmarking AGENTS.md
   requires before making any real-time-factor claims.

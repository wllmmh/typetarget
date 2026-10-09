# Architecture

TypeTarget is a Manifest V3 Chrome extension. It captures one tab's audio, transcribes it,
and types the text into a text box the user picked, which may be in another tab.

## Components

```
 popup (React)          right-click menu
      │ PopupRequest          │ contextMenus.onClicked
      ▼                       ▼
 ┌──────────────────────────────────────┐   BackgroundToContent    ┌──────────────────────┐
 │ service worker  (src/background)     │ ───────────────────────► │ content script       │
 │ state, routing, persistence,         │ ◄─────────────────────── │ (src/content), or    │
 │ capture / destination controllers    │   ContentToBackground    │ editor tab           │
 └──────────────────────────────────────┘                          │ (src/editor)         │
      │ BackgroundToOffscreen   ▲ OffscreenToBackground            └──────────────────────┘
      ▼                         │ (transcript events, stats)
 ┌──────────────────────────────────────┐
 │ offscreen document (src/offscreen)   │  tab capture → speakers
 │                                      │            └→ AudioWorklet → 16 kHz PCM
 └──────────────────────────────────────┘
      │ AsrWorkerRequest        ▲ AsrWorkerEvent
      ▼                         │
 ┌──────────────────────────────────────┐
 │ ASR worker (src/worker)              │  EngineRouter → whisper.cpp | Groq | Gemini Live
 └──────────────────────────────────────┘
```

- **Service worker** (`src/background/service-worker.ts`) coordinates everything and holds
  `AppState`. It runs no audio, because MV3 can stop it at any time.
  - `capture-controller.ts` starts and stops capture through the offscreen document and
    watches the source tab.
  - `destination-controller.ts` injects the content script and talks to the destination
    frame.
  - `transcript-router.ts` turns offscreen reports into insertions and popup state.
  - `context-menu.ts` keeps the right-click submenu in step with state.
  - `known-tabs.ts` is the list of tabs TypeTarget may capture
    ([ADR 0008](docs/adr/0008-source-tab-is-the-tab-typetarget-was-invoked-on.md)).
- **Offscreen document** (`src/offscreen`) owns the tab capture `MediaStream`. It plays the
  audio back to the speakers (capture mutes the tab otherwise), taps it through an
  AudioWorklet, resamples to 16 kHz mono and feeds the worker. It also owns the worker's
  lifetime and remembers the chunk length and API keys for when the worker is created.
- **ASR worker** (`src/worker`). `EngineRouter` picks a provider per model
  ([ADR 0004](docs/adr/0004-pluggable-transcription-engines.md)):
  - `whisper-cpp` and `groq` are discrete. Each `StreamingTranscriber` runs an `EnergyVad`
    and sends one utterance per inference call, capped by the chunk length.
  - `gemini-live` streams continuously over one connection and marks boundaries itself
    ([ADR 0006](docs/adr/0006-client-side-utterance-boundaries-for-gemini-live.md)).

  `TranscriptStabilizer` turns provider output into `partial` and `final` events. Only finals
  are inserted.
- **Content script** (`src/content`) is injected on demand into the tab being picked in,
  never declared for all sites.
  - `bridge.ts` wires messages to `destination-session.ts`, which handles selection mode, the
    picked element and its insertion offset, the outline, and the badge with its buttons.
  - `insert-text.ts` writes text without clobbering the user's own edits
    ([ADR 0011](docs/adr/0011-contenteditable-insertion-through-execcommand.md)).
  - `new-file-field.ts` is the "Type to new file" box.
- **Editor tab** (`src/editor`) is a full-page text box that the new-file box can be moved
  into ("Open in new tab"). It runs the same bridge.
- **Popup** (`src/popup`) is a view of `PublicAppState` plus controls. It is destroyed
  whenever it closes, so it holds no state of its own.
- **Domain** (`src/domain`) holds shared contracts: messages, models, tuning bounds, API key
  providers and sender checks.

## Data flow of one utterance

1. The offscreen worklet posts ~100 ms batches. They are resampled to 16 kHz and sent to the
   worker. Batches are dropped (and counted) until the engine reports `ready`.
2. The engine decides where the utterance ends (VAD pause or chunk cap) and produces a
   `final`.
3. The offscreen document forwards the `transcript-event`. The service worker accepts it only
   from the offscreen page's URL.
4. `transcript-router.ts` chains insertions in order and sends `insert-text` to the
   destination's frame only.
5. The content script inserts at its tracked boundary. A space goes before the text unless
   the boundary is at the very start of the field.

## State and persistence

`src/background/persisted-state.ts` stores the following, split by how long it lives:

| Area | Contents |
| --- | --- |
| `storage.local` (restricted to extension pages) | selected model, chunk length, "Show outline", API keys |
| `storage.session` | known tabs, pending source tab, destination and its label, running capture |
| IndexedDB (worker) | downloaded model files |

Tab, frame and element ids only mean something within one browser session, so they never go
to `storage.local`. When a restarted service worker finds a stored capture, it asks the
offscreen document (`get-capture-status`) whether it is still running and reattaches if so.
Popup requests, menu clicks and offscreen messages all wait for that check.

## Invariants

Breaking any of these has caused a real failure before. The postmortems have the details.

- **No COOP/COEP manifest keys** while capture uses `tabCapture`. They break capture silently
  ([ADR 0001](docs/adr/0001-single-threaded-whisper-build-to-keep-tab-capture.md)).
- **A tab capture stream feeds one consumer.** The tap shares playback's `AudioContext` and
  source node ([postmortem](docs/postmortems/2026-09-22-silent-audio-tap.md)).
- **Get the stream id before loading the model.** `getMediaStreamId` is tied to the user
  gesture, and a cold download outlives it
  ([postmortem](docs/postmortems/2026-09-22-start-failed-while-loading-the-model.md)).
- **One whisper module factory per worker.** The glue can be imported only once per global
  scope.
- **The content bridge installs once per frame**, however many times the script is injected,
  and `insert-text` is addressed to the destination's `frameId`
  ([postmortem](docs/postmortems/2026-09-22-duplicate-transcript-insertion.md)).
- **Nothing from before a reset is emitted after it.** `StreamingTranscriber`'s `generation`
  counter, Gemini's `lifecycle` counter and the offscreen reset on start and stop ensure this.
- **Check who sent a message, not just its shape.** `domain/sender.ts` checks the sender.
  Offscreen documents get only part of `chrome.runtime` (no `getManifest`), so the service
  worker is recognised structurally.
- **API keys never reach the popup or a content script**
  ([ADR 0007](docs/adr/0007-api-keys-in-local-extension-storage.md)). Popup requests, which
  can set them, are accepted only from the popup page.
- **Websites can't detect TypeTarget.** Nothing is web-accessible (`vite.config.ts` strips the
  entry crx adds), the source tab's title never reaches a content script, and content-script
  click handlers ignore untrusted events
  ([ADR 0012](docs/adr/0012-websites-cannot-detect-typetarget.md)).
- **With "Show outline" off, nothing is drawn on the page's own text boxes**, not
  even for a moment. The setting travels with every message that can lead to a pick
  ([ADR 0013](docs/adr/0013-option-to-hide-indicators-on-the-page.md)).
- **Model files are pinned and hash-checked.** Each download must match its SHA-256 in
  `model-urls.ts` before it is cached
  ([ADR 0003](docs/adr/0003-models-downloaded-at-runtime-and-cached.md)).
- **The `?script&iife` import** in `destination-controller.ts` is how @crxjs builds the
  dynamically injected content script. Tests alias it to `src/test/content-script-stub.ts`.

## Further reading

- [docs/specs/whisper-wasm-provenance.md](docs/specs/whisper-wasm-provenance.md): the
  vendored whisper.cpp build and its API.
- [docs/adr/](docs/adr/): why things are the way they are.
- [docs/privacy-audit.md](docs/privacy-audit.md): where data is stored and sent.

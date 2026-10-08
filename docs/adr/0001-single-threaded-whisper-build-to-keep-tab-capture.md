# 0001. Single-threaded whisper.cpp build, to keep tab capture working
- Status: Accepted
- Date: 2026-09-22

## Context

whisper.cpp's stock WASM build uses pthreads, which need `SharedArrayBuffer`, which Chrome
only provides to cross-origin-isolated pages. An extension turns isolation on with the
manifest keys `cross_origin_embedder_policy: require-corp` and
`cross_origin_opener_policy: same-origin`. That works for the threaded build: four threads
cut one `tiny.en` inference from ~13.5 s to ~3.3 s.

Isolation is enforced per process. Isolated extension pages get their own render process,
while the service worker stays non-isolated (verified in Chrome 153). A `tabCapture` stream
id can only be consumed in the same render process as the caller, so the offscreen
document's `getUserMedia` fails with `Error starting tab capture` (see
[the postmortem](../postmortems/2026-09-22-cross-origin-isolation-broke-tab-capture.md)).
The isolation keys are all-or-nothing per manifest, an extension may only have one
offscreen document, and a service worker cannot start a `Worker`, so isolated inference and
non-isolated capture cannot coexist.

## Decision

Ship a single-threaded build (`-s USE_PTHREADS=0`) with no COOP/COEP manifest keys. Tab
capture is the product, so it wins over inference speed. Dropping pthreads also needs a
source patch (`third_party/whisper-wasm/single-thread.patch`), because upstream's
`full_default` detaches a `std::thread`, which aborts without pthreads. The patch runs
inference synchronously and forces `n_threads = 1`.

## Consequences

- Local inference runs roughly 4× slower than the threaded build. See
  [the performance devlog](../devlog/2026-09-23-local-whisper-performance.md).
- The `nthreads` argument to `full_default` has no effect.
- Re-adding the COOP/COEP keys silently breaks capture again. Threads could come back only
  by replacing `tabCapture` with `chrome.desktopCapture`, whose stream ids are checked by
  origin rather than by process. That swap was not adopted (see
  [0010](0010-hosted-models-for-live-transcription.md)).

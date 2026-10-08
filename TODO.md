# TODO

## Verify in a real browser

- [ ] Make a real Groq request with a real key, and see how a 429 (rate limit) shows in the
      popup. So far only a fake `fetch` has been tested.
- [ ] Hand-test the 2026-10-08 changes: reattaching after a service-worker restart
      (`chrome://serviceworker-internals` → Stop), the error when the capture stream ends, the
      hosted-model notice, and the "slower than real time" warning.
- [ ] Check whether Chrome fires the track's `ended` event for every way a tab capture dies
      (navigation, tab discard).
- [ ] Check whether "Listen to this tab" from a real menu click gets an `activeTab` grant that
      `getMediaStreamId` accepts. Synthetic dispatch grants none.
- [ ] Check how `activeTab` survives tab switches when selection follows the user. So far
      only host permissions have stood in for it.
- [ ] Test contenteditable insertion in a genuinely hidden tab.
- [ ] Test Gemini end to end in the extension (popup → offscreen → worker → insertion) since
      the client-side boundary change. The engine has been verified against the API, and the
      user has used Gemini, but no deliberate pass has been made.

## Fix

- [ ] Gemini: a boundary forced by the chunk cap in mid-phrase loses the straddling word.
      Defer a cap cut to the next low-energy frame
      ([ADR 0006](docs/adr/0006-client-side-utterance-boundaries-for-gemini-live.md)).
- [ ] Open findings 3–6 from the [privacy audit](docs/privacy-audit.md): the badge puts the
      source tab's title in the destination page's DOM; the content script is web-accessible
      to all sites; the badge and picker accept synthetic clicks; downloaded models are not
      hash-checked.

## Clean up

- [ ] Unused code paths: the `set-source-tab` popup request (no UI sends it since the source
      dropdown went), the `load-model` / `download-model` popup requests (answered "not
      implemented"), `deleteCachedModel` in `model-cache.ts`, and `hypothesisDelta` in
      `stabilizer.ts` (used only by its tests).

## Ideas, not planned

- A `chrome.sidePanel` UI, so controls and diagnostics stay visible while typing elsewhere.
  The popup closes whenever the user clicks into the page.
- Faster local Whisper (fitted `audio_ctx`, threads through `desktopCapture`, SIMD quant
  kernels). See [the performance devlog](docs/devlog/2026-09-23-local-whisper-performance.md).
- A `SECURITY.md` with a private way to report vulnerabilities before public release.

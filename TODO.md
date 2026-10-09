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
- [ ] Check that injection still works with no `web_accessible_resources` (2026-10-08): Select
      field, the right-click menu's Type to this field and Type to new file, on a top-level page
      and inside an iframe. Then confirm from a page's console that
      `fetch("chrome-extension://<id>/src/content/main.js")` fails.
- [ ] Download a local model in Chrome and confirm it passes its SHA-256 check (2026-10-08). Also
      check how a failed check shows in the popup.
- [ ] Check that the badge buttons and the picker still respond to real mouse clicks, and to
      Enter and Space on a focused button, now that untrusted events are ignored.
- [ ] With "Show indicators on the page" off (2026-10-08): pick by Select field and by the
      right-click menu and confirm nothing appears on the page (watch with a MutationObserver
      in the page's console), the toolbar badge shows REC / II / ..., toggling mid-capture
      redraws or removes the outline, and Type to new file opens an editor tab.
- [ ] Test Gemini end to end in the extension (popup → offscreen → worker → insertion) since
      the client-side boundary change. The engine has been verified against the API, and the
      user has used Gemini, but no deliberate pass has been made.

## Fix

- [ ] Gemini: a boundary forced by the chunk cap in mid-phrase loses the straddling word.
      Defer a cap cut to the next low-energy frame
      ([ADR 0006](docs/adr/0006-client-side-utterance-boundaries-for-gemini-live.md)).

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

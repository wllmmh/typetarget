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
- [ ] Load Medium Q8 and each Large model in Chrome and transcribe with it (2026-10-14). Their
      weights plus working memory may not fit the ~2 GB WASM heap, and a ~1 GB download is
      held twice in memory while it is hashed. Drop any that fail.
- [ ] Check that the badge buttons and the picker still respond to real mouse clicks, and to
      Enter and Space on a focused button, now that untrusted events are ignored.
- [ ] With "Show outline" off (2026-10-08): pick by Select field and by the
      right-click menu and confirm nothing appears on the page (watch with a MutationObserver
      in the page's console), the toolbar badge shows REC / II / ..., toggling mid-capture
      redraws or removes the outline, and Type to new file opens an editor tab.
- [ ] Right-click menu and the editor tab (2026-10-14): choose Type to new tab on a page and
      confirm the editor tab opens and types. Press Stop typing, right-click the editor's text
      box, and confirm Type to this field is enabled and starts typing again.
- [ ] Test Gemini end to end in the extension (popup → offscreen → worker → insertion) since
      the client-side boundary change. The engine has been verified against the API, and the
      user has used Gemini, but no deliberate pass has been made.

- [ ] Have a native speaker review each translation in `_locales/` (2026-10-14). They were
      machine-written, and the badge buttons, right-click menu and API key dialog were only
      checked in English; the popup and editor tab were seen in Japanese and German.

## Fix

- [ ] No space between utterances in languages written without spaces (Chinese, Japanese,
      Thai): `insert-text.ts` always adds one.

- [ ] Gemini: a boundary forced by the 3 s utterance cap in mid-phrase loses the straddling word.
      Defer a cap cut to the next low-energy frame
      ([ADR 0006](docs/adr/0006-client-side-utterance-boundaries-for-gemini-live.md)).

## Tests

- [ ] Playwright end-to-end tests against the built `dist/`, run in CI. They would turn most of
      "Verify in a real browser" above into checks that keep passing. Start with a harness that
      loads the extension in Chromium and drives what Playwright can reach, given the limits in
      CONTRIBUTING.md's "Testing in Chrome" (no toolbar clicks, no native context menu, no
      `activeTab` grant headlessly):
  - Insertion: open `src/offscreen/index.html` as a tab and send `transcript-event` finals
    through the real router into a test page's `<textarea>`, `contenteditable` and a Lexical
    editor, including one in an iframe.
  - Picking: Select field and `contextMenus.onClicked.dispatch`, with "Show outline" on and off.
    With it off, assert through a MutationObserver that nothing is added to the page.
  - Stealth: from a test page, `fetch("chrome-extension://<id>/src/content/main.js")` fails.
  - Service-worker restart mid-capture: stop the worker through CDP and check the capture is
    picked back up.
  - Model download: serve a small file with the wrong hash and check it is rejected and not
    cached.

## Ideas, not planned

- Translate error messages. Most are built in the background or the ASR worker (which has no
  `chrome.i18n`) and some wrap a provider's own text, so the popup would need an error code
  to translate from ([ADR 0015](docs/adr/0015-ui-text-in-the-browsers-language.md)).
- Localize the Chrome Web Store listing's description and screenshots per language.

- A `chrome.sidePanel` UI, so controls and diagnostics stay visible while typing elsewhere.
  The popup closes whenever the user clicks into the page.
- Faster local Whisper (fitted `audio_ctx`, threads through `desktopCapture`, SIMD quant
  kernels). See [the performance devlog](docs/devlog/2026-09-23-local-whisper-performance.md).
- A `SECURITY.md` with a private way to report vulnerabilities before public release.

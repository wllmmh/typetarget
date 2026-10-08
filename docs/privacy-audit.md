# Privacy audit — 2026-10-08

A review of where TypeTarget's data (tab audio, transcripts, API keys, tab metadata) is
stored, sent and exposed, done against the source at this date. The user-facing summary is
[PRIVACY.md](../PRIVACY.md); this file is the evidence behind it and the list of open issues.

## Summary

No telemetry, analytics, remote logging or developer-side collection exists. Audio leaves the
device only for the selected hosted provider. One issue was fixed during the audit (API keys
were readable from the content script), and a missing "Remove key" control was added. Four
issues remain open, the most significant being that the badge shows a different tab's title
inside the destination page's DOM.

## What was checked

| Area | How | Result |
| --- | --- | --- |
| Logging | grep for `console.*` in `src/` | Two `console.warn`s (context-menu update failure, storage access-level failure). Neither includes user data. |
| Network | grep for `fetch`, `WebSocket`, `XMLHttpRequest`, `sendBeacon`, URLs | Only: Hugging Face model downloads (`model-downloader.ts`), Groq (`groq-engine.ts`), Gemini via `@google/genai` (`gemini-live-engine.ts`). Host permissions cover only the two API origins. |
| What providers receive | Read `groq-engine.ts`, `createGeminiLiveConnect` | Groq: one WAV per utterance, plus model id, `language`, `response_format`, `temperature`. Gemini: realtime audio and activity start/end markers. No page content, tab titles or transcripts are sent. |
| Persistent storage | grep for `chrome.storage`, `indexedDB`, `localStorage` | `storage.local`: model, chunk length, API keys. `storage.session`: known tabs (title, URL, favicon), pending source, destination ref and label, running capture. IndexedDB: downloaded model files. No audio or transcripts are stored. |
| External messaging | Manifest `externally_connectable`, grep for `onMessageExternal`, window `message` listeners | None. Web pages cannot message the extension. |
| Message trust | `domain/sender.ts` and its call sites | Offscreen → background messages are checked against the offscreen document's URL; editor-page messages against the editor URL; destination actions against the destination's own tab and frame. |
| Content script reach | `destination-controller.ts`, manifest | Injected on demand through `activeTab` + `scripting`, never declared for all sites. |
| Error text | Provider error paths | Groq/Gemini error messages are shown in the popup only, never logged. A 401 from Groq is replaced with fixed text. |

## Findings

### Fixed

**1. API keys were readable from the content script.** `storage.local` is exposed to content
scripts by default ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/storage)),
and TypeTarget's content script runs inside arbitrary web pages. Nothing in the content script
reads storage, but a compromised or exploited content-script context could have read the keys.
Fixed: the service worker calls `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`
on every start (`restrictLocalStorageToExtension` in `background/persisted-state.ts`).
`storage.session` was already restricted by default.

**2. A saved API key could not be removed without uninstalling.** The dialog ignored an empty
field. Fixed: a "Remove key" button in the API Keys dialog clears it (the background already
treated an empty key as "clear").

### Open

**3. The badge shows the source tab's title inside the destination page (medium).** The
listening badge above the output field is an ordinary element in the host page's DOM, and its
label is the title of the tab being listened to. That tab is usually a different site, so the
destination site's scripts can read which video, meeting or page the user is listening to.
*Recommendation:* render the badge (and its buttons) inside a closed shadow root, or drop the
tab title from the label and keep it only in the popup.

**4. The extension is detectable by any website (low).** `src/content/main.js` is listed in
`web_accessible_resources` for all `http`/`https` pages with `use_dynamic_url: false`, so any site
can probe `chrome-extension://<id>/src/content/main.js` to learn TypeTarget is installed (a
fingerprinting signal). The script is injected with `chrome.scripting.executeScript({ files })`,
which does not itself need the resource to be web-accessible; the entry comes from
`@crxjs/vite-plugin`'s dynamic-script support. *Recommendation:* set `use_dynamic_url: true` in
`defineDynamicResource`, or drop the entry if crxjs builds without it; verify injection still
works in Chrome either way.

**5. Page scripts can operate the badge's buttons and selection mode (low).** Click handlers on
the badge buttons and the destination picker do not check `event.isTrusted`, so page JavaScript
can dispatch synthetic clicks: stop typing (X), trigger a `.txt` download of the field's text
(Save), move the output to the editor tab, or pick a field during selection mode. None of these
sends data off the device or to the page beyond what it can already read. *Recommendation:*
ignore events where `isTrusted` is false.

**6. Downloaded models are not integrity-checked (low).** Model files from Hugging Face are
cached and loaded without a pinned hash. A tampered file would be parsed by whisper.cpp inside
the WASM sandbox, with no extension API access. *Recommendation:* pin SHA-256 hashes in
`model-urls.ts` and verify after download.

### Accepted by design (disclosed in PRIVACY.md)

- **Destination pages can read what is typed into them**, including the "Type to new file" box,
  which lives in the page's DOM. This is inherent to typing into a page. A closed shadow root
  would hide the new-file box from page scripts if that becomes a goal.
- **API keys are stored unencrypted** in the browser profile's extension storage, which is
  normal for bring-your-own-key extensions. Anything able to read the Chrome profile on disk can
  read them.
- **Hugging Face sees model download requests** (IP address, user agent).
- **Tab titles and URLs of tabs TypeTarget was opened on** are kept in session storage, cleared
  when the browser closes.

## Not covered

- No dynamic analysis: network traffic was not captured in a running browser. The network list
  above comes from source review only. `@google/genai`'s browser build imports only `p-retry`
  and contacts only Google API hosts; its "telemetry" is the `x-goog-api-client` header (SDK
  version labels) sent to the Gemini API with each request, not a separate endpoint.
- No review of the providers' own data handling beyond linking their policies.

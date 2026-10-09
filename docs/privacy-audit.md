# Privacy audit — 2026-10-08

A review of where TypeTarget's data (tab audio, transcripts, API keys, tab metadata) is
stored, sent and exposed, done against the source at this date. The user-facing summary is
[PRIVACY.md](../PRIVACY.md); this file is the evidence behind it and the list of open issues.

## Summary

No telemetry, analytics, remote logging or developer-side collection exists. Audio leaves the
device only for the selected hosted provider. One issue was fixed during the audit (API keys
were readable from the content script), and a missing "Remove key" control was added. The four
issues left open, and a fifth found in a follow-up review (finding 7), were fixed the same day.
None remain open. Websites can no longer detect that TypeTarget is installed
([ADR 0012](adr/0012-websites-cannot-detect-typetarget.md)).

## What was checked

| Area | How | Result |
| --- | --- | --- |
| Logging | grep for `console.*` in `src/` | Two `console.warn`s (context-menu update failure, storage access-level failure). Neither includes user data. |
| Network | grep for `fetch`, `WebSocket`, `XMLHttpRequest`, `sendBeacon`, URLs | Only: Hugging Face model downloads (`model-downloader.ts`), Groq (`groq-engine.ts`), Gemini via `@google/genai` (`gemini-live-engine.ts`). Host permissions cover only the two API origins. |
| What providers receive | Read `groq-engine.ts`, `createGeminiLiveConnect` | Groq: one WAV per utterance, plus model id, `language`, `response_format`, `temperature`. Gemini: realtime audio and activity start/end markers. No page content, tab titles or transcripts are sent. |
| Persistent storage | grep for `chrome.storage`, `indexedDB`, `localStorage` | `storage.local`: model, chunk length, page-indicator setting (added after the audit), API keys. `storage.session`: known tabs (title, URL, favicon), pending source, destination ref and label, running capture. IndexedDB: downloaded model files. No audio or transcripts are stored. |
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

**3. The badge showed the source tab's title inside the destination page (medium).** The
listening badge above the output field is an ordinary element in the host page's DOM, and its
label was the title of the tab being listened to. That tab is usually a different site, so the
destination site's scripts could read which video, meeting or page the user was listening to.
Fixed: the title no longer reaches the content script at all. `SessionIndicator` carries no
tab name, the badge reads "TypeTarget 1:05", and the Save button's file is named only by date
and time. Only the popup shows the source tab's title.

**4. The extension was detectable by any website (low).** `src/content/main.js` was listed in
`web_accessible_resources` for all `http`/`https` pages with `use_dynamic_url: false`, so any site
could probe `chrome-extension://<id>/src/content/main.js` to learn TypeTarget is installed (a
fingerprinting signal). `@crxjs/vite-plugin` adds that entry for every dynamically injected
script, whatever the manifest declares. Fixed: the `noWebAccessibleResources` build plugin in
`vite.config.ts` removes it, so the built manifest has no `web_accessible_resources`.
`executeScript({ files })` doesn't need the entry, and the script is a self-contained IIFE.
Injection without it has not yet been checked in Chrome (tracked in [TODO.md](../TODO.md)).

**5. Page scripts could operate the badge's buttons and selection mode (low).** Click handlers
on the badge buttons and the destination picker did not check `event.isTrusted`, so page
JavaScript could dispatch synthetic clicks: stop typing (X), trigger a `.txt` download of the
field's text (Save), move the output to the editor tab, or pick a field during selection mode.
Fixed: both ignore events whose `isTrusted` is false (`isUserEvent` in
`src/content/user-event.ts`).

**6. Downloaded models were not integrity-checked (low).** Model files were fetched from the
mutable `main` branch on Hugging Face and cached without a hash check. A tampered file would have
been parsed by whisper.cpp inside the WASM sandbox, with no extension API access. Fixed:
`model-urls.ts` pins the URLs to one repository commit and lists each file's SHA-256 (its Git LFS
object id). `model-downloader.ts` hashes each download and rejects a mismatch before it reaches
the cache.

**7. Any extension context could send popup requests (low).** The service worker took
`PopupRequest`s (save an API key, change the model, start capture...) without checking the
sender. Web pages can't message the extension, but TypeTarget's content script can, and it runs
inside arbitrary pages, so a compromised content script could have replaced a key. Found in a
follow-up review the same day. Fixed: popup requests are accepted only from the popup page
(`isFromExtensionPage(sender, "src/popup/index.html")`).

### Accepted by design (disclosed in PRIVACY.md)

- **A page TypeTarget is used on can see it there**: the outline, the badge and its buttons,
  and the "Type to new file" box are in that page's DOM while it holds the output. Pages
  TypeTarget is not used on see nothing ([ADR 0012](adr/0012-websites-cannot-detect-typetarget.md)).
  "Show outline" (off) removes them from the page's own text boxes; the inserted
  text still shows ([ADR 0013](adr/0013-option-to-hide-indicators-on-the-page.md)).
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

# TypeTarget — Directed Transcriber

Captures a browser tab's audio and streams transcribed text into a text field you
choose in another tab. You choose how it's transcribed: a hosted model (Groq or
Gemini, with your own API key), which keeps up live on any computer, or Whisper
running in the browser, which keeps audio on your device but only keeps up live on a
fast enough machine.

## Models

The popup's Model dropdown lists every supported model, grouped by provider:

- **Whisper** (`tiny.en-q5_1`, the default, plus `tiny.en` and `base.en`) — runs in the
  browser in a Worker, with no network access and nothing to configure. Whether it keeps up
  live depends on your computer, and on most it won't; the popup tells you when it is
  falling behind. The first use of each model downloads it once (31–142 MB) and caches it. Also listed: quantized
  `tiny.en-q8_0`, `base.en-q5_1`/`-q8_0`, `small.en-q5_1`/`-q8_0`, `medium.en-q5_0`/`-q8_0`,
  and full-precision `small.en` (42–785 MB), from the same mirror. Larger models are more
  accurate but much slower; the full-precision `medium.en` and the large models don't fit in
  the bundled WASM build's ~2 GB memory.
- **Gemini** (`3.5 Transcribe (Live)`) — Google's Gemini Live API, a persistent
  streaming connection. Optional; requires your own Gemini API key (see "API keys"
  below) and sends captured audio to Google.
- **Groq** (`Whisper Large v3 Turbo`, `Whisper Large v3`) — Groq's hosted Whisper. Each
  finished utterance is uploaded to Groq as a short WAV file and the text comes back in
  one request. Optional; requires your own Groq API key and sends captured audio to
  Groq. Groq bills every request as at least 10 seconds of audio, so a longer chunk
  length (see below) costs less per minute of speech.

Only one model is active per capture session. Audio is only sent anywhere while a Gemini
or Groq model is selected, and the popup says so under the model picker.

## Chunk length

The slider caps how long one utterance can grow (3–25 s) before it is transcribed
anyway; a pause in speech finalizes it sooner. With the in-browser Whisper models, each
transcription costs about the same regardless of length, so a longer chunk keeps up
better on slow hardware. It also sets how often Gemini and Groq receive a finished utterance.

## API keys

Network models need an API key, which you provide yourself — TypeTarget does not ship
with or share any key. Click the key icon next to the model picker to open a dialog with the field for that model's provider. A key is:

- Stored only in this browser's local extension storage (`chrome.storage.local`), never
  synced or sent anywhere except as authentication to the provider it belongs to.
- Never displayed back to you once saved (the field shows "•••• saved" instead of the
  value) and never logged.
- Effective immediately, including mid-session — no restart needed.

## Permissions

- **tabCapture** — capture audio from the source tab you select. Core to the feature.
- **activeTab** — lets the popup act on the current tab without a persistent host
  permission, and grants the scripting access needed to inject the destination picker
  into whatever tab you're looking at when you click "Select field".
- **scripting** — inject/remove the destination content script programmatically
  (activeTab-scoped), instead of a persistent `<all_urls>` content script.
- **storage** — persist small bits of state: selected model, destination binding, and
  any API keys you enter. Never history, audio, or transcripts.
- **offscreen** — run the long-lived audio + transcription pipeline outside the
  service worker, which Chrome can otherwise kill at any time.
- **contextMenus** — adds a "TypeTarget" submenu to the page's right-click menu, with
  "Listen to this tab" (starts listening to the tab you right-clicked in, even one you never
  opened the popup on; right-click a different tab while listening to switch to it), "Stop listening" (greyed out unless capturing),
  "Type to this field" (greyed out unless you right-clicked a text box, and on the one that is already
  the output), "Type to new file" (anywhere, text boxes included: opens a text box over the bottom third
  of the page and types into that), and "Stop typing" (works from anywhere while there is an output box;
  a "new file" box stays on the page with its text, marked "Not typing"),
  so you can drive TypeTarget from the tab you're typing into. The output box's colored outline carries
  two buttons on its top right: X (stops typing, and closes a "new file" box) and Save,
  which downloads the box's text to your device as a `.txt` file.
  Choosing an item gives TypeTarget the same one-tab access as opening the popup there.
- **host_permissions** (`generativelanguage.googleapis.com`, `api.groq.com`) — lets the
  optional Gemini and Groq engines reach their providers' APIs. Each is only contacted
  while one of its models is selected and capturing.

No other host permissions are declared. Destination selection works on any page via
`activeTab` + `chrome.scripting`, scoped to the one tab you're actively picking a
destination in — either the tab "Select field" was clicked in, or the tab where you
right-clicked a text box and chose TypeTarget → "Select field".

## Privacy

- **Hosted models send audio to their provider.** While capturing, a Gemini model streams
  captured audio to Google, and a Groq model uploads each finished utterance to Groq,
  using your API key. The popup shows this under the model picker whenever one is selected.
- **Whisper models keep audio on your device.** They need no key and send nothing.
- **Nothing is logged or telemetered.** No audio, transcript, or API key leaves this
  device except audio sent to the hosted model you selected.
- **API keys can be removed** at any time with Remove key in the API Keys dialog.

The full privacy policy is in [PRIVACY.md](PRIVACY.md); the audit behind it, with open issues,
is in [docs/privacy-audit.md](docs/privacy-audit.md).

## License

MIT — see [LICENSE](LICENSE). Bundled third-party code (whisper.cpp, React, `@google/genai`
and its dependencies) is listed with its licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

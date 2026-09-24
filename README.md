# WaveType — Local Live Transcriber

Captures a browser tab's audio and streams transcribed text into a text field you
choose in another tab. Transcription runs locally by default (Whisper, compiled to
WASM) — no audio or transcript ever leaves the device unless you deliberately pick a
network model and supply your own API key.

## Models

The popup's Model dropdown lists every supported model, grouped by provider:

- **Whisper** (`tiny.en`, `tiny.en-q5_1`, `base.en`) — runs fully local in a Worker,
  no network access, nothing to configure. The default.
- **Gemini** (`3.5 Transcribe (Live)`) — Google's Gemini Live API, a persistent
  streaming connection. Optional; requires your own Gemini API key (see "API keys"
  below) and sends captured audio to Google.

Selecting a network model shows an inline notice in the popup naming which provider
your audio goes to. Only one model is active per capture session; nothing is sent
anywhere unless you've explicitly picked a network model.

## API keys

Network models need an API key, which you provide yourself — WaveType does not ship
with or share any key. Click **API Keys** in the popup to open a dialog with one field
per provider. A key is:

- Stored only in this browser's local extension storage (`chrome.storage.local`), never
  synced or sent anywhere except as authentication to the provider it belongs to.
- Never displayed back to you once saved (the field shows "•••• saved" instead of the
  value) and never logged.
- Effective immediately, including mid-session — no restart needed.

## Permissions

- **tabCapture** — capture audio from the source tab you select. Core to the feature.
- **activeTab** — lets the popup act on the current tab without a persistent host
  permission, and grants the scripting access needed to inject the destination picker
  into whatever tab you're looking at when you click "Select output".
- **scripting** — inject/remove the destination content script programmatically
  (activeTab-scoped), instead of a persistent `<all_urls>` content script.
- **storage** — persist small bits of state: selected model, destination binding, and
  any API keys you enter. Never history, audio, or transcripts.
- **offscreen** — run the long-lived audio + transcription pipeline outside the
  service worker, which Chrome can otherwise kill at any time.
- **host_permissions** (`generativelanguage.googleapis.com`) — lets the optional Gemini
  engine reach Google's API. Only used when you've selected a Gemini model; not
  contacted otherwise.

No other host permissions are declared. Destination selection works on any page via
`activeTab` + `chrome.scripting`, scoped to the one tab you're actively picking a
destination in.

## Privacy

- **Local by default.** The Whisper models never send audio anywhere; everything runs
  in this browser.
- **Gemini is opt-in.** Selecting a Gemini model is a deliberate choice, shown with an
  inline warning in the popup — captured audio is streamed to Google using your API
  key for as long as that model stays selected.
- **Nothing is logged or telemetered.** No audio, transcript, or API key leaves this
  device except audio sent to a network model you've explicitly selected.

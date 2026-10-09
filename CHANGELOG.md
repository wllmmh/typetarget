# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Transcribe a browser tab's audio and type the text into a text field you pick, in the same
  tab or another one. Text goes in after what is already there and leaves your own edits alone.
- Local Whisper models that run in the browser with no key and no network: Tiny, Base, Small
  and Medium in English, full-precision and quantized. Each downloads once and is cached.
  Tiny Q5 is the default.
- Hosted models with your own API key: Gemini 3.5 Transcribe Live (Google), and Whisper Large v3 and
  v3 Turbo on Groq.
- API Keys dialog with Get API Key and Remove key. Keys stay on this device.
- Chunk length slider (3–25 s), which caps how long one utterance can grow and can be changed
  while listening.
- Right-click "TypeTarget" menu: Listen to this tab, Stop listening, Type to this field, Type
  to new file and Stop typing.
- "Type to new file": a text box over the bottom third of the page. It can be minimized,
  opened in a new tab and moved back, and stays on the page after Stop typing.
- A badge on the output's outline with a listening timer ("TypeTarget 1:05"), plus buttons to
  save the text as a `.txt` file (named like `TypeTarget-2026-10-08T17-30-05.txt`) and to stop
  typing.
- Selection follows you into other tabs while you are picking a field.
- "Show indicators on the page" setting in the popup. Turned off, the field you type into gets no
  outline, timer or buttons, the toolbar icon shows REC instead, and "Type to new file" opens in
  a new tab.
- A notice in the API Keys dialog when a hosted model will receive audio, and a popup warning
  when a local model is slower than real time on this computer.
- Popup diagnostics: audio level, finals, inference timings and model download progress.
- Gemini reconnects by itself, without losing audio, when a connection drops or reaches the
  free tier's time limit.
- Capture continues across a service-worker restart, and stops with an error when the
  source tab's audio ends.

### Security
- Websites can't detect that TypeTarget is installed: no file is web-accessible.
- The page you type into no longer sees which tab you are listening to. The badge reads
  "TypeTarget" and the timer, and saved files are named by date and time only.
- Page scripts can no longer press the badge's buttons or pick a field for you.
- Downloaded Whisper models are pinned to a fixed version and checked against a SHA-256 hash
  before they are cached.
- Only the popup can change settings, API keys or capture. Other parts of the extension can't.

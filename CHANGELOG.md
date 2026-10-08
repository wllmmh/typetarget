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
- Hosted models with your own API key: Gemini 3.5 Transcribe (Live), and Whisper Large v3 and
  v3 Turbo on Groq.
- API Keys dialog with Get API Key and Remove key. Keys stay on this device.
- Chunk length slider (3–25 s), which caps how long one utterance can grow and can be changed
  while listening.
- Right-click "TypeTarget" menu: Listen to this tab, Stop listening, Type to this field, Type
  to new file and Stop typing.
- "Type to new file": a text box over the bottom third of the page. It can be minimized,
  opened in a new tab and moved back, and stays on the page after Stop typing.
- A badge on the output's outline with the source tab's name and a listening timer, plus
  buttons to save the text as a `.txt` file (named like `TypeTarget-My_Video-2026-10-08T17-30-05.txt`,
  with the tab's title and spaces as underscores) and to stop typing.
- Selection follows you into other tabs while you are picking a field.
- Popup notice when a hosted model will receive audio, and a warning when a local model is
  slower than real time on this computer.
- Popup diagnostics: audio level, finals, inference timings and model download progress.
- Gemini reconnects by itself, without losing audio, when a connection drops or reaches the
  free tier's time limit.
- Capture continues across a service-worker restart, and stops with an error when the
  source tab's audio ends.

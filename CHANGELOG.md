# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Transcribe a browser tab's audio and type the text into a text field you pick, in the same
  tab or another one. Text goes in after what is already there and leaves your own edits alone.
- Local Whisper models that run in the browser with no key and no network: the multilingual
  Tiny, Base, Small, Medium and Large (v2, v3 and v3 Turbo), full-precision and quantized where
  they fit in memory. Each downloads once and is cached. Tiny Q5 is the default.
- Hosted models with your own API key: Gemini 3.5 Transcribe Live (Google), and Whisper Large v3 and
  v3 Turbo on Groq.
- Every model transcribes speech in the language it is spoken in. The Whisper models, local and
  on Groq, detect it for each utterance, out of the 99 languages Whisper knows, instead of
  assuming English. A very short utterance can be detected as the wrong language, so the popup
  has a "Spoken language" menu, under the model, to name it instead
  (Auto by default; it can be changed while listening). Each language is listed by its name in
  the browser's language, with its own name beside it ("Spanish   Español"). It shows Auto and is greyed out while a
  Gemini model is selected, since Gemini always detects the language itself.
- API Keys dialog with Get API Key. A key is saved when you click Done, not when you leave the
  field, and closing the dialog any other way discards what you typed. A saved key shows as dots
  in the field; clear the field and click Done to remove it. Keys stay on this device.
- In the model menu, each hosted provider's heading has an "API key" action that opens that
  provider's key dialog. The separate key button is gone.
- Continuous speech is sent to the model in chunks, without waiting for a pause. A "Chunk
  length" slider under Start listening sets how long they are, from 3 seconds (the default) to
  25; it can be changed while listening. Longer chunks give the model more speech to detect the
  language from, and shorter ones get text sooner. Local Whisper stretches past the slider, up
  to 25 seconds, on a machine too slow to keep up, and shortens it again (never below the slider)
  when it can.
- Right-click "TypeTarget" menu: Listen to this tab, Stop listening, Type to this field, Type
  to new file, Type to new tab and Stop typing. "Type to new tab" opens the full-page text box
  straight away, without going through the new-file box's Open in new tab button. After Stop
  typing in a new tab, right-clicking its text box and choosing "Type to this field" starts
  typing there again.
- "Type to new file": a text box over the bottom third of the page. It can be minimized,
  opened in a new tab and moved back, and stays on the page after Stop typing.
  Its text grows with the window (15px in a 640x400 window, 30px at 1280x800) instead of staying
  at 15px. In it, and in the tab it opens in, each piece of text is typed out over at most 0.25
  seconds instead of appearing all at once (all at once in a background tab, or with reduced
  motion on).
- The popup has one Start/Stop button for listening and one for typing, replacing Pause and
  Select field. Start typing is "Type to new file" on the tab the popup was opened on; to type
  into an existing field, use right-click → Type to this field.
- A badge on the output's outline with a listening timer ("TypeTarget 1:05"), plus buttons to
  save the text as a `.txt` file (named like `TypeTarget-2026-10-08T17-30-05.txt`) and to stop
  typing. While nothing is listening, the badge is red and reads "Not listening" instead.
- A text box scrolled to its bottom follows new transcribed text. One you have scrolled up
  keeps your position.
- Selection follows you into other tabs while you are picking a field.
- "Show outline" setting in the popup. Turned off, the field you type into gets no
  outline, timer or buttons, the toolbar icon shows REC instead, and "Type to new file" opens in
  a new tab.
- A notice in the API Keys dialog when a hosted model will receive audio, and a popup warning
  when a local model is slower than real time on this computer.
- Popup diagnostics: audio level, finals, inference timings and model download progress. The
  Diagnostics link at the popup's foot opens a dialog with the status and the numbers, so the
  popup fits without scrolling; the download bar and warnings stay visible.
- Help and Contact links at the popup's foot, to the website's FAQ and the contact form.
- A hosted model with no saved key says "Gemini API key required" (or Groq) beside the Model
  heading, and the "no audible audio" warning sits beside "Listening to", instead of each taking
  a line of its own. The dot on the model menu is the error color. Clicking "API key
  required" opens that provider's key dialog. Errors about the text box being typed into
  (a page TypeTarget can't type on, a text box that has gone) sit beside "Typing to", short
  and in the browser's language; hover one for Chrome's own reason.
- Gemini reconnects by itself, without losing audio, when a connection drops or reaches the
  free tier's time limit.
- Capture continues across a service-worker restart, and stops with an error when the
  source tab's audio ends.
- Popup styled like Chrome's own UI: pill buttons, hairline-divided sections, rounded
  menus and dialogs, in light and dark to match the system theme. The title is set in
  Geist Mono.
- The popup, right-click menu, badge buttons, new-file box and editor tab follow the browser's
  display language: English, Arabic, Bengali, Czech, Filipino, German, Spanish, French,
  Hindi, Indonesian, Italian, Marathi, Polish, Brazilian and European Portuguese, Russian, Telugu,
  Thai, Turkish, Ukrainian, Urdu, Vietnamese, Japanese, Korean, and Simplified and Traditional
  Chinese. In Arabic and Urdu the popup and editor tab are laid out right to left. Other
  languages get English. Error messages are still in English, except those beside "Typing to".

### Security
- Websites can't detect that TypeTarget is installed: no file is web-accessible.
- The page you type into no longer sees which tab you are listening to. The badge reads
  "TypeTarget" and the timer, and saved files are named by date and time only.
- Page scripts can no longer press the badge's buttons or pick a field for you.
- Downloaded Whisper models are pinned to a fixed version and checked against a SHA-256 hash
  before they are cached.
- Only the popup can change settings, API keys or capture. Other parts of the extension can't.

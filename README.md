# TypeTarget — Directed Transcriber

Captures a browser tab's audio and streams transcribed text into a text field you
choose in another tab. You choose how it's transcribed: a hosted model (Groq or
Gemini, with your own API key), which keeps up live on any computer, or Whisper
running in the browser, which keeps audio on your device but only keeps up live on a
fast enough machine.

## Install

TypeTarget is not on the Chrome Web Store yet. To build and load it yourself (Chrome or
Chromium 116+):

```sh
npm install && npm run build
```

Then open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick
`dist/`. Local Whisper models also need the vendored whisper.cpp build; see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Using it

1. On the tab you want transcribed, click the TypeTarget toolbar button and press
   **Start listening**. The popup listens to the tab it was opened on.
2. Click **Select field**, then click any text box, in that tab or another one.
3. Text appears there as people speak. **Pause**, **Stop listening** and **Stop typing** are
   in the popup.

Everything is also in the page's right-click menu under **TypeTarget**: Listen to this tab,
Stop listening, Type to this field, Type to new file (a text box over the bottom third of the
page) and Stop typing.

The output box gets a colored outline with the source tab's name and a timer. Its buttons
save the text as a `.txt` file and stop typing. A "new file" box can also be minimized or
opened in a new tab.

## Models

The popup's Model dropdown lists every supported model, grouped by provider:

- **Local Whisper** (`tiny.en-q5_1`, the default, plus `tiny.en` and `base.en`) — runs in the
  browser in a Worker, with no network access and nothing to configure. Whether it keeps up
  live depends on your computer, and on most it won't; the popup tells you when it is
  falling behind. The first use of each model downloads it once (31–142 MB) and caches it.
  Also listed: quantized `tiny.en-q8_0`, `base.en-q5_1`/`-q8_0`, `small.en-q5_1`/`-q8_0`,
  `medium.en-q5_0`/`-q8_0`, and full-precision `small.en` (42–785 MB), from the same mirror.
  Larger models are more accurate but much slower; the full-precision `medium.en` and the
  large models don't fit in the bundled WASM build's ~2 GB memory.
- **Gemini** (`3.5 Transcribe (Live)`) — Google's Gemini Live API, a persistent
  streaming connection. Optional; requires your own Gemini API key and sends captured audio
  to Google.
- **Groq** (`Whisper Large v3 Turbo`, `Whisper Large v3`) — Whisper hosted by Groq. Each
  finished utterance is uploaded to Groq as a short WAV file. Optional; requires your own
  Groq API key and sends captured audio to Groq. Groq bills every request as at least 10
  seconds of audio.

**Chunk length** (3–25 s, default 3 s) caps how long one utterance can grow before it is
transcribed anyway; a pause in speech finalizes it sooner. A longer chunk helps local
Whisper keep up on slow hardware and lowers Groq's per-request cost.

**API keys**: click the key icon next to the model picker. A key is stored only in this
browser's extension storage, sent only to its own provider, never shown again once saved,
and takes effect immediately. Remove key deletes it.

## Permissions

| Permission | Why |
| --- | --- |
| `tabCapture` | Capture the audio of the tab you choose. |
| `activeTab` | Act on the tab where you opened the popup or used the right-click menu, without broad host permissions. |
| `scripting` | Inject the field picker into that tab, on demand, instead of a content script on every site. |
| `storage` | Remember the model, chunk length, API keys, and the current source tab and field. |
| `offscreen` | Run audio capture and transcription outside the service worker, which Chrome can stop at any time. |
| `contextMenus` | The TypeTarget right-click menu. |
| `generativelanguage.googleapis.com`, `api.groq.com` | Reach Gemini and Groq, only while one of their models is selected and listening. |

## Privacy

Audio leaves your device only when a Gemini or Groq model is selected, and then goes only to
that provider. There are no servers, accounts, analytics or logs. See
[PRIVACY.md](PRIVACY.md) and the [privacy audit](docs/privacy-audit.md).

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the extension fits together
- [CONTRIBUTING.md](CONTRIBUTING.md): setup, checks, testing in Chrome, releasing
- [CHANGELOG.md](CHANGELOG.md) and [TODO.md](TODO.md)
- [docs/adr/](docs/adr/) (decisions), [docs/postmortems/](docs/postmortems/) (bugs),
  [docs/specs/](docs/specs/) (vendored whisper.cpp build, Groq API notes)

## License

MIT — see [LICENSE](LICENSE). Bundled third-party code (whisper.cpp, React, `@google/genai`
and its dependencies) is listed with its licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

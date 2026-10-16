# TypeTarget — Speech to text anywhere

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

1. Right-click anywhere on the tab you want transcribed and choose **TypeTarget → Listen to
   this tab**.
2. Right-click anywhere on a page and choose **TypeTarget → Type to new file**, for a text box
   over the bottom third of the page. Or right-click any existing text field already on the
   page, in that tab or another one, and choose **TypeTarget → Type to this field**. **Type to
   new tab** opens a full-page text box in a new tab. After **Stop typing** in a new tab,
   right-click its text box and choose **Type to this field** to start typing there again.
3. Text appears there as people speak. **Stop typing** and **Stop listening** are in the same
   menu.

The toolbar popup has one button each for listening and typing (**Start listening** /
**Stop listening**, **Start typing** / **Stop typing**), both acting on the tab the popup was
opened on, plus the model picker, the spoken language and API keys. **Start typing** is **Type
to new file**.

The output box gets a colored outline, a "TypeTarget" timer and buttons that save the text as
a `.txt` file and stop typing. The page you type into is never told which tab you are
listening to; only the popup shows that. A "new file" box can also be minimized or
opened in a new tab.

To keep the site you type into from seeing TypeTarget, turn off **Show outline**
in the popup. The field then gets no outline or buttons, the toolbar icon shows **REC** while
typing, and "Type to new file" opens in a new tab. The site can still see the text arrive.

## Models

The popup's Model dropdown lists every supported model, grouped by provider:

- **Local Whisper** (`tiny-q5_1` is the default) — runs in the browser in a Worker, with no
  network access and nothing to configure. Whether it keeps up live depends on your computer,
  and on most it won't; the popup tells you when it is falling behind. The first use of each
  model downloads it once and caches it. The multilingual Tiny, Base and Small models are
  listed quantized (Q5, Q8) and full-precision, Medium as Q5 and Q8, and Large as v3 Turbo
  Q5/Q8, v2 Q5 and v3 Q5 (31 MB–1 GB), all from whisper.cpp's model mirror. Larger models
  are more accurate but much slower; full-precision Medium and Large don't fit in the
  bundled WASM build's ~2 GB memory.
- **Google** (`Gemini 3.5 Transcribe Live`) — Google's Gemini Live API, a persistent
  streaming connection. Optional; requires your own Gemini API key and sends captured audio
  to Google.
- **Groq** (`Whisper Large v3 Turbo`, `Whisper Large v3`) — Whisper hosted by Groq. Each
  finished utterance is uploaded to Groq as a short WAV file. Optional; requires your own
  Groq API key and sends captured audio to Groq. Groq bills every request as at least 10
  seconds of audio.

**Languages**: every model transcribes speech in the language it is spoken in. The Whisper
models, local and on Groq, detect it for each utterance out of the 99 languages Whisper knows,
and Gemini detects it too. A very short utterance (a word or two) can be detected as the wrong
language, so with a Whisper model you can name it in the popup's **Spoken language** menu
instead of leaving it on Auto. It shows Auto, greyed out, while Gemini is selected. TypeTarget's own menus and buttons follow the browser's display language, in 26
languages (`_locales/`), with English for the rest.

**Live text**: a pause in speech sends what was said to the model. In continuous speech, it
is sent anyway once it reaches the **Chunk length** set under Start listening (3 to 25 seconds,
3 by default). A longer chunk helps the model detect the spoken language, at the cost of text
arriving later. Local Whisper lengthens it, up to 25 seconds, on a machine too slow to keep up,
and shortens it again when it can.

**API keys**: open the model menu and click **API key** on the provider's heading. A key is
stored only in this browser's extension storage, sent only to its own provider, never shown
again once saved, and takes effect immediately. A key is saved when you click Done. A saved key shows as dots; clear the field and click Done to delete it.

## Permissions

| Permission | Why |
| --- | --- |
| `tabCapture` | Capture the audio of the tab you choose. |
| `activeTab` | Act on the tab where you opened the popup or used the right-click menu, without broad host permissions. |
| `scripting` | Inject the field picker into that tab, on demand, instead of a content script on every site. |
| `storage` | Remember the model, spoken language, page-indicator setting, API keys, and the current source tab and field. |
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
- [docs/adr/](docs/adr/) (decisions) and [docs/specs/](docs/specs/) (vendored whisper.cpp
  build, Groq API notes)

## License

MIT — see [LICENSE](LICENSE). Bundled third-party code (whisper.cpp, React, `@google/genai`
and its dependencies) is listed with its licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

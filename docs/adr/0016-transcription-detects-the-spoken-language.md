# 0016. Whisper detects the spoken language instead of assuming English
- Status: Accepted; the menu names languages in the UI's language too, and sorts by that name, since [ADR 0020](0020-spoken-languages-named-in-the-ui-language-too.md)
- Date: 2026-10-14

## Context

Every Whisper model TypeTarget offers is multilingual: the local whisper.cpp files
([ADR 0014](0014-multilingual-local-whisper-models.md)) and Groq's Whisper Large v3 and v3
Turbo. Both engines still sent `language: "en"`, so speech in any other language came out as
English-sounding text. Gemini already detected the language itself.

## Decision

Neither Whisper engine names a language unless one is passed in `TranscriptionOptions`:

- **whisper.cpp** gets `"auto"`, which makes `whisper_full` detect the language from the
  audio before decoding. `translate` stays `false`, so the text stays in the spoken language.
- **Groq** gets no `language` field, which makes it detect the language.

A **Spoken language** menu in the popup, under the model, names the language instead. Auto (the
default) keeps detection; otherwise the code is passed to every inference call. It is saved in
`storage.local` and applies from the next utterance, including while listening. It offers Whisper's languages that have an ISO 639-1
code (97; `domain/languages.ts`), each by its own name (Polski, Tiếng Việt, 日本語), the same
in every UI language: a speaker looks for the name they write, and there is nothing to
translate. The names are a fixed table from CLDR, not `Intl.DisplayNames` at run time, so they
don't depend on how much locale data the browser ships. Javanese and Hawaiian, which Whisper
names `jw` and `haw`, are left out because Groq asks for ISO 639-1 codes. Cantonese is left out
because only the large-v3 models know it.

With a Gemini model selected the menu shows Auto and is disabled. Gemini always detects the
language here; its SDK takes language hints (`inputAudioTranscription.languageCodes`), which
could be wired to the same menu later. The saved choice is kept and comes back with a Whisper
model.

## Consequences

- Speech in any of Whisper's 99 languages is transcribed in that language.
- **Detection is per utterance and unreliable on short ones.** Run against the vendored build
  with Tiny Q5, an 11-second English clip was detected as English (p = 0.98), but a
  1.2-second French "bonjour" was detected as Russian (p = 0.51) and came out as "Боже.".
  Naming the language gave "Bonjour !". English speakers can now get the occasional short
  utterance in the wrong language or script on Auto, which `"en"` used to prevent; naming the
  language in the popup avoids it.
- Detection costs one extra encoder pass per utterance on local Whisper, which matters on
  machines that already fall behind real time.
- The menu is sorted with English collation, Unicode's default order across scripts, so it is
  the same in every UI language (Latin-script names first). `Intl.Collator("und")` would follow
  the browser's language in Chrome.
- `EngineRouter` now remembers options and applies them to each transcriber it activates.
  Options sent before a model loaded, which the offscreen document replays when it creates
  the worker, used to be dropped.
- Text is still inserted with a space before each utterance, which is wrong for languages
  written without spaces (Chinese, Japanese, Thai).

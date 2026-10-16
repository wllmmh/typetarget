# 0018. The chunk length slider returns, as a floor under the keep-up stretch
- Status: Accepted
- Date: 2026-10-16

## Context

[ADR 0017](0017-utterance-cap-set-by-typetarget.md) removed the "Chunk length" slider and fixed
the utterance cap at 3 s, stretched for local Whisper on a slow machine. That decision only
weighed the cap's effect on latency and keeping up.

It also affects language detection
([ADR 0016](0016-transcription-detects-the-spoken-language.md)). With the spoken language on
Auto, Whisper detects the language for each utterance, so in continuous speech every
3-second piece is a fresh guess. Short pieces are where detection goes wrong. A user transcribing
a language other than English, who would rather wait longer for text than get it in the wrong
language, had no way to give the model more to go on.

## Decision

Bring back the slider: the same range (3–25 s in 1 s steps, default 3 s), now under the Start
listening button in the "Listening to" section. It is stored in `storage.local` as `chunkMs`,
the key the old slider used, so a value an older build saved comes back. It is clamped on the
way in from the popup and from storage (`clampUtteranceCapMs`), and can be changed while
listening.

The chunk length is the cap for every model. Local Whisper still stretches past it to keep up,
but never below it: its cap is the chunk length or the last inference's time plus a quarter,
whichever is longer, at most 25 s (`stretchedUtteranceCapMs`). The stretch is kept apart from the
chunk length, so changing the slider mid-session doesn't undo it, and a reset drops only the
stretch.

## Consequences

- Users can trade liveness for steadier language detection, on any model.
- Users can also lengthen the cap for hosted models, for example to send Groq fewer requests,
  which ADR 0017 had ruled out.
- A slow machine keeps up with local Whisper whatever the slider says, as under ADR 0017.
- The popup's "slower than real time" warning compares the last local inference with the
  chunk length rather than with 3 s.

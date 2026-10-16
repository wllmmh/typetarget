# 0017. TypeTarget sets the utterance cap; the chunk length slider is gone
- Status: Superseded by [ADR 0018](0018-chunk-length-slider-returns.md), which brings the slider back
- Date: 2026-10-14

## Context

An utterance ends at a pause in speech or, in continuous speech, at a cap. The popup exposed the
cap as a "Chunk length" slider (3–25 s, default 3 s). Its right value depends on the model and the
machine, which users can't see and TypeTarget can measure:

- Local Whisper costs about the same per call whatever the audio's length, because the encoder
  pads to a 30 s window. It keeps up only while one call takes less than the cap, which at 3 s
  most machines can't do. The slider was the only way to fix that, by hand.
- Groq and Gemini are fast enough for a 3 s cap. A longer cap would only take them further from
  live. Groq bills each request as at least 10 s, but that is the user's choice with their own key.

## Decision

Remove the slider and its stored setting. The cap is 3 s (`UTTERANCE_CAP_MS`) for every model,
except that local Whisper stretches it to keep up: after each final, its cap becomes the
inference's time plus a quarter, between 3 s and 25 s (`stretchedUtteranceCapMs`). A faster call
brings it back down, and a reset (each start or stop) returns it to 3 s.

## Consequences

- Hosted models stay as live as a 3 s cap allows, on any machine.
- A slow machine keeps up with local Whisper instead of falling further and further behind,
  at the cost of text arriving in longer pieces. The popup still warns when a call is slower
  than the 3 s base, since that is when this happens.
- Nobody can lengthen the cap for hosted models, for example to send Groq fewer requests.
- A `chunkMs` value stored by an older build stays in `storage.local`, unread.

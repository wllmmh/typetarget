# 0022. The chunk length goes from 1 to 30 seconds
- Status: Accepted
- Date: 2026-10-20

## Context

[ADR 0018](0018-chunk-length-slider-returns.md) brought back the "Chunk length" slider with a
3–25 s range. 3 s was the floor because it had been the fixed cap, and 25 s left room under
Whisper's 30 s window for the pre-roll. Neither bound is a hard limit. Gemini streams and can
end an utterance at any point, and a Whisper utterance's pre-roll already counts toward the cap.

## Decision

The slider goes from 1 s to 30 s in 0.5 s steps. The default stays 3 s. The value is shown
with the UI language's decimal separator ("1,5" in German). `clampUtteranceCapMs`
clamps to the new bounds, from the popup and from storage. Local Whisper's keep-up stretch
also tops out at 30 s. At 1 s the value reads "1 second", from a message of its own, since
most of the UI's languages put the unit in the plural for 3.

## Consequences

- Text can arrive sooner in continuous speech, mostly with Gemini, at the cost of more cuts.
  Gemini cuts at a quiet frame ([ADR 0021](0021-gemini-cap-cut-at-a-quiet-frame.md)), but
  Whisper (local and Groq) still cuts at the cap and can split a word.
- Short chunks make language detection worse ([ADR 0018](0018-chunk-length-slider-returns.md)).
  Groq bills each request as at least 10 s, so 1 s chunks cost ten times as much per minute of
  speech.
- Local Whisper costs the same per call whatever the length, so on most machines a 1 s chunk
  is stretched to keep up and makes no difference there. The "slower than real time" warning,
  which compares an inference with the chunk length, shows more often.
- At 30 s, a Whisper utterance can pass the 30 s window by up to one ~100 ms batch.

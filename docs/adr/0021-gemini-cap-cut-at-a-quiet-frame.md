# 0021. Gemini's cap cut waits for a quiet frame
- Status: Accepted
- Date: 2026-10-20

## Context

[ADR 0006](0006-client-side-utterance-boundaries-for-gemini-live.md) ends a Gemini utterance
with `activityEnd` at a pause or, in continuous speech, as soon as it reaches the chunk-length
cap. A cut at the cap usually lands inside a word, and Gemini transcribes neither half: at a 3 s
cap, "fellow" in `jfk.wav` was lost every time.

## Decision

Once an utterance reaches the cap, the `activityEnd` goes after the first quiet 20 ms frame
(RMS under `EnergyVad`'s threshold) that ends at or past the cap. The batch holding that frame
is split there. The part before the cut ends the utterance, and the rest is sent after the
`activityEnd`, so it starts the next one. If no quiet frame comes within 1 s of the cap, the cut
is made anyway at the end of the batch that crosses that second.

## Consequences

- A cap cut falls between words when speech has any gap in it.
- An utterance in continuous speech can run up to 1 s past the chunk length, so its text can
  arrive up to 1 s later.
- Where nothing gets quiet, for example speech over music, the cut comes 1 s late and can still
  split a word.
- A stop consonant's closure can be quiet enough to count, so a cut can still land inside a
  word. The threshold and frame length are not tuned against the real API.

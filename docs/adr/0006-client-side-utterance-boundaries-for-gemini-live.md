# 0006. Client-side utterance boundaries for Gemini Live
- Status: Accepted
- Date: 2026-09-23

## Context

The first design relied on Gemini's server-side turn detection and emitted finals on
`turnComplete`. Probing the real service (the SDK in Node, `jfk.wav` streamed at real-time
pace, every server message logged) showed this could not work. The server never sends
`turnComplete` for transcription. And with automatic detection on, speech after each detected
end was ignored for seconds, so whole sentences went missing under every
`activityHandling` / `turnCoverage` / `silenceDurationMs` variant tried.

## Decision

The client marks utterance boundaries itself:

- `automaticActivityDetection: { disabled: true }` and `turnCoverage: TURN_INCLUDES_ALL_INPUT`.
- An `activityEnd` is sent at a local `EnergyVad` pause or at the chunk-length cap.
- The next `activityStart` is sent only after the server acknowledges with `ACTIVITY_END`. An
  `activityStart` sent before that is silently dropped, losing every other utterance.
- Audio keeps streaming throughout. All-input coverage folds audio sent while waiting for the
  acknowledgement into the next utterance.
- An utterance's final is the bare `inputTranscription` that arrives before the
  acknowledgement.

## Consequences

- No speech is lost at pauses. Against the real API, finals arrived ~0.5–1 s after each phrase
  ended.
- The chunk-length slider now affects Gemini too.
- A boundary forced by the cap in the middle of a phrase loses the word that straddles it
  (reproducibly "fellow" at a 3 s cap). Deferring a cap cut to the next low-energy frame
  would fix it; this is tracked in [TODO.md](../../TODO.md).

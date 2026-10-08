# 0004. Pluggable transcription engines behind `EngineRouter`
- Status: Accepted
- Date: 2026-09-22

## Context

TypeTarget started with one hardcoded engine (whisper.cpp). Adding hosted providers meant
supporting two different shapes:

- **Discrete**: one request per finished utterance, with text coming back per request
  (whisper.cpp, Groq). The VAD and chunk-length scheduling in `StreamingTranscriber` already
  fits this shape.
- **Streaming**: a persistent connection fed audio continuously, with text arriving
  asynchronously (Gemini Live).

## Decision

Each model in `MODEL_CATALOG` names its `provider`. `src/worker/engine-router.ts` dispatches
on it and presents one object to `asr-worker-controller.ts` that satisfies both
`TranscriptionEngine` (load, unload, status) and the streaming shape (`pushAudio`, `flush`,
`reset`, `setOptions`). Discrete providers get their own `StreamingTranscriber` (with its own
VAD and stabilizer) around their engine. A streaming provider implements both shapes in one
class.

API keys are keyed by provider (`ApiKeyProvider`), so storage, messages and the popup dialog
work for any number of providers.

## Consequences

- Adding a discrete provider is one `TranscriptionEngine` plus one router entry. Groq went
  in that way (2026-09-29) without changes to the router or controller.
- Every provider's text goes through `TranscriptStabilizer`, so the partial/final contract
  downstream is the same whatever produced it.

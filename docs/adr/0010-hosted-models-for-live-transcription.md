# 0010. Hosted models are the route to live transcription; local Whisper is optional
- Status: Accepted
- Date: 2026-10-08

## Context

The project started local-first: whisper.cpp in the browser, with hosted engines as opt-in
extras. The shipped single-threaded build runs about 2× slower than real time on a 12-core
desktop. Near-live local transcription would need about a 13× speedup. The levers that were
measured (threads, a fitted `audio_ctx`, quantized models) each carry a real cost: a capture
flow change and a duplicate tab picker, a whisper.cpp rebuild plus a short-utterance policy,
or accuracy. See [the performance devlog](../devlog/2026-09-23-local-whisper-performance.md).

## Decision

TypeTarget is not local-first. In-browser Whisper is one method among several, live only on a
fast enough machine. Hosted models (Groq, Gemini) are how most users get live transcription.
Making local Whisper fast enough is not a goal, so the threading and `audio_ctx` levers are
shelved, with their measurements kept in the devlog.

- `tiny.en-q5_1` becomes `DEFAULT_MODEL`. It is the fastest local model with an identical
  transcript, and it needs no key or account.
- Hosted models are still never the default, because sending audio off-device must be a
  deliberate choice and needs the user's own key.
- The popup warns when a local model's last inference took longer than the chunk length, and
  points at Groq or Gemini.

## Consequences

- README, store listing and privacy copy describe local Whisper as the private option that
  keeps up only on fast computers.
- A stored `selectedModel` still wins over the default, so existing installs keep their pick.

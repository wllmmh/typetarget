# 0014. Local Whisper uses the multilingual models, from tiny up to large
- Status: Accepted
- Date: 2026-10-14

## Context

Local Whisper offered only the mirror's English-only (`.en`) files, tiny through medium.
whisper.cpp's mirror also has multilingual files for every size, including large-v2, large-v3
and large-v3-turbo, which the `.en` line has no equivalent of. The vendored WASM build's heap
tops out near 2 GB (see [the provenance spec](../specs/whisper-wasm-provenance.md)).

## Decision

Offer only the multilingual files, in the tiers tiny, base, small, medium and large, and none
of the `.en` files. Within each tier, list every file that fits the heap:

- Tiny, Base and Small: Q5, Q8 and full precision.
- Medium: Q5 and Q8. Full precision (1.43 GiB) doesn't fit.
- Large: v3 Turbo Q5 and Q8, v2 Q5 and v3 Q5. Full-precision v3 Turbo (1.51 GiB), v2 Q8
  (1.54 GiB) and every full-precision large model (2.88 GiB) don't fit.

`tiny-q5_1` replaces `tiny.en-q5_1` as `DEFAULT_MODEL`
([ADR 0010](0010-hosted-models-for-live-transcription.md)). Transcription is still asked for in
English (`language: "en"`), as with Groq. [ADR 0016](0016-transcription-detects-the-spoken-language.md)
later replaced that with language detection.

## Consequences

- Small multilingual models are somewhat less accurate on English than their `.en` twins.
- A stored `.en` model id is no longer valid, so existing installs fall back to the default.
  Their downloaded `.en` files stay in IndexedDB, unused.
- Whether Medium Q8 and the large models load alongside their working memory is unverified.
  A large download is also held twice in memory while it is hashed.

# 0005. Gemini through the Live API and the official `@google/genai` SDK
- Status: Accepted
- Date: 2026-09-22

## Context

Google offers Gemini 3.5 Transcribe in two forms: a batch model (`gemini-3.5-transcribe`,
upload then transcribe) and a Live API model (`gemini-3.5-transcribe-live`, a persistent
WebSocket). The API was weeks old, and scraped documentation gave inconsistent model names
across sources.

## Decision

- Use the **Live API**. The product's goal is live transcription, and any network engine
  needed pipeline changes anyway, so the batch API would not have been a smaller change.
- Use Google's **official SDK** (`@google/genai`, pinned to 2.24.0) rather than a hand-rolled
  WebSocket client. The API shape was read from the SDK's shipped `.d.ts`, not from prose
  docs. The SDK has a real browser build (`exports["."].browser` → `dist/web/index.mjs`) whose
  only runtime import is `p-retry`. It has no Node built-ins or `ws`, and Vite resolves it
  automatically.

## Consequences

- The worker bundle grew from ~11 KB to ~427 KB minified.
- The Live API's config types are marked `@experimental` in the SDK, so Google may still
  change this API surface.
- The SDK's types and runtime disagree in at least one place: `voiceActivity` arrives as
  `type`, not `voiceActivityType`. The engine reads both.
- The free tier ends each connection after about 10 minutes, so the engine has to
  reconnect, which it does without losing audio (see `gemini-live-engine.ts`).

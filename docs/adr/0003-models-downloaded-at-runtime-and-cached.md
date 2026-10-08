# 0003. Whisper models downloaded at runtime and cached in IndexedDB
- Status: Accepted
- Date: 2026-09-18

## Context

GGML model files range from 31 MB (`tiny.en-q5_1`) to 785 MB (`medium.en-q8_0`). Bundling
even one would bloat the extension package and every update. Users who only use hosted
models never need them.

## Decision

Download each model on its first use from the Hugging Face mirror that whisper.cpp's own
`models/download-ggml-model.sh` uses
(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<model>.bin`), and cache
the bytes in IndexedDB (`src/worker/model-cache.ts`). Later loads read from the cache.

## Consequences

- The first use of a model needs the network and can take a minute or more, so the popup
  shows download progress.
- Hugging Face sees each download request. This is disclosed in [PRIVACY.md](../../PRIVACY.md).
- Downloaded files are not hash-checked yet (privacy audit finding 6, tracked in
  [TODO.md](../../TODO.md)).

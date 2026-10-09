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
(`https://huggingface.co/ggerganov/whisper.cpp/resolve/<commit>/ggml-<model>.bin`), and cache
the bytes in IndexedDB (`src/worker/model-cache.ts`). Later loads read from the cache.

The URLs are pinned to one repository commit, and each file's SHA-256 is listed in
`src/worker/model-urls.ts`. A download whose hash doesn't match is rejected and never cached.
Pinning and hashing were added on 2026-10-08 after the [privacy audit](../privacy-audit.md)
(finding 6).

## Consequences

- The first use of a model needs the network and can take a minute or more, so the popup
  shows download progress.
- Hugging Face sees each download request. This is disclosed in [PRIVACY.md](../../PRIVACY.md).
- Only verified bytes reach the cache, so the cache is not re-hashed on each load. Hashing a
  785 MB model on every start would add a noticeable delay.
- Adding a model, or moving to a newer commit, means updating its hash too. The Hugging Face
  API's file listing (`/api/models/ggerganov/whisper.cpp/tree/<commit>`) gives each file's
  `lfs.oid`, which is its SHA-256.

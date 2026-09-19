Place the vendored whisper.cpp WASM build here:

- `libmain.js` — single-file build (wasm embedded); no separate `.wasm`.

Download command, checksum, glue shape and the rules the worker must follow are in
[`docs/whisper-wasm-provenance.md`](../../docs/whisper-wasm-provenance.md).

This directory is empty in version control on purpose — these are large, externally
built binary artifacts, not source this repo owns.

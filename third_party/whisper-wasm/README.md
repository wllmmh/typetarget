Place the vendored whisper.cpp WASM build output here:

- `libmain.js`
- `libmain.wasm` (only if built with `WHISPER_WASM_SINGLE_FILE=OFF`)

See [`docs/whisper-wasm-provenance.md`](../../docs/whisper-wasm-provenance.md) for
exactly what to build, from where, and the API this codebase expects it to expose.

This directory is empty in version control on purpose — these are large, externally
built binary artifacts, not source this repo owns.

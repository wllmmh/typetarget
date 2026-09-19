Place the vendored whisper.cpp WASM build here:

- `libmain.js` — single-file build (wasm embedded); no separate `.wasm`.

It must be **our own build with `-s DYNAMIC_EXECUTION=0`**, not the hosted demo build,
which fails under the MV3 extension CSP. Rebuild recipe, commit, checksum and the
reasons are in [`docs/whisper-wasm-provenance.md`](../../docs/whisper-wasm-provenance.md).

This directory is empty in version control on purpose — these are large, externally
built binary artifacts, not source this repo owns.

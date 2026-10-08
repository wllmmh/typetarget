Place the vendored whisper.cpp WASM build here:

- `libmain.js` — single-file build (wasm embedded); no separate `.wasm`.

It must be **our own build with `-s DYNAMIC_EXECUTION=0` and `-s USE_PTHREADS=0`**, not the
hosted demo build (which fails under the MV3 extension CSP) and not a threaded build (whose
`SharedArrayBuffer` requirement forces cross-origin isolation, which breaks tab capture). Rebuild recipe, commit, checksum and the
reasons are in [`docs/specs/whisper-wasm-provenance.md`](../../docs/specs/whisper-wasm-provenance.md).

This directory is empty in version control on purpose — these are large, externally
built binary artifacts, not source this repo owns.

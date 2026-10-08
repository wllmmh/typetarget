# 0002. whisper.cpp glue built from source with `DYNAMIC_EXECUTION=0`
- Status: Accepted
- Date: 2026-09-18

## Context

whisper.cpp publishes a hosted demo build (`https://ggml.ai/whisper.cpp/libmain.js`). Its
Embind glue creates call invokers with `new Function(...)`. MV3 extension pages cannot allow
`unsafe-eval`, and the `'wasm-unsafe-eval'` the manifest does set only covers WebAssembly
compilation. The hosted build therefore fails at runtime startup inside the extension (see
[the postmortem](../postmortems/2026-09-18-hosted-whisper-glue-blocked-by-mv3-csp.md)). No
npm package ships a usable build.

## Decision

Build `libmain.js` ourselves from a pinned whisper.cpp commit, with
`-s DYNAMIC_EXECUTION=0`, as a single-file build (wasm embedded). The output is not
committed: `third_party/whisper-wasm/*.js` is gitignored and copied into `dist/whisper/` by
`vite.config.ts`. The commit, flags, checksum and rebuild recipe live in
[docs/specs/whisper-wasm-provenance.md](../specs/whisper-wasm-provenance.md).

## Consequences

- A fresh clone builds but cannot transcribe locally until someone rebuilds or supplies
  `libmain.js`. The build prints a warning when the file is missing.
- Every whisper.cpp upgrade needs a rebuild and re-verification of the output format the
  engine parses.

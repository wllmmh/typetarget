# bench/

Manual performance tooling, not part of the extension build. See HANDOFF.md "Local
Whisper performance" for the full picture; this directory just holds the tools.

- `whisper-bench.html` — loads a `libmain.js` glue build directly in a plain page and times
  repeated `full_default` calls. Open via `serve.mjs`, not `file://`.
- `serve.mjs` — a zero-dependency Node static server (no Python needed — this is already a
  Node project) that adds the COOP/COEP headers needed for `crossOriginIsolated` /
  `SharedArrayBuffer` (required by the threaded build below; a plain static server won't set
  these). `node bench/serve.mjs` from the repo root, then open
  `http://localhost:8000/bench/whisper-bench.html`.
- `libmain-threaded.js` — **gitignored, not committed.** An experimental pthreads build for
  testing Lever 1 (see HANDOFF.md). Not present in a fresh clone; rebuild it yourself:

  ```
  git clone https://github.com/emscripten-core/emsdk.git && (cd emsdk && ./emsdk install latest && ./emsdk activate latest)
  git clone https://github.com/ggml-org/whisper.cpp.git && cd whisper.cpp
  git checkout 5670d5c0bbcb148feabef84400a07cfca9aa3b30   # same commit as third_party/whisper-wasm; re-pin if that changes
  source ../emsdk/emsdk_env.sh
  ```

  Then add a single line to `examples/whisper.wasm/CMakeLists.txt`'s `LINK_FLAGS` (do **not**
  apply `third_party/whisper-wasm/single-thread.patch` — that patch is specifically for the
  no-pthreads production build and would defeat the point here): `-s DYNAMIC_EXECUTION=0 \`
  right after `-s FORCE_FILESYSTEM=1 \`. That's the only change from stock upstream — pthreads
  (`USE_PTHREADS=1`) stay on, `examples/whisper.wasm/emscripten.cpp` stays unpatched (its
  detached `std::thread` works correctly once real pthreads back it; it only aborts in the
  no-pthreads production build, which is why that build needs the patch and this one doesn't).

  ```
  cmake -B build-em -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_WASM_SINGLE_FILE=ON
  cmake --build build-em --target libmain -j 8
  cp build-em/bin/libmain.js <this repo>/bench/libmain-threaded.js
  ```

  (`cmake`/`ninja` don't need root — the official prebuilt binaries from
  `github.com/Kitware/CMake/releases` and `github.com/ninja-build/ninja/releases` work fine
  extracted anywhere on `PATH`, no `apt`/`pip` needed. Built and verified working with
  Emscripten 6.0.10, cmake 4.4.3, ninja 1.13.2 on 2026-09-22.)

  **Known caveat, found while building this** (see HANDOFF.md "Lever 3" for the full story):
  a plain `emcmake cmake` invocation — this one included — never triggers ggml's
  `CMAKE_SYSTEM_PROCESSOR MATCHES "wasm"` branch, because Emscripten's own toolchain file sets
  that variable to the literal string `"x86"`. So this build (like the production one) uses
  ggml's generic/portable quantized kernels, not the hand-written WASM-SIMD ones — confirmed
  by checking which `quants.c` object file actually got compiled, not assumed from source.

  I could not run or benchmark this build myself (no browser binary in the sandbox that built
  it) — it compiles cleanly and contains the expected `SharedArrayBuffer`/`Atomics`/`pthread`
  markers, but that is not the same as confirming it actually works end to end. Treat first
  real results from it as the first real test of whether this approach works at all, not just
  a speed number.

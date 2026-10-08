# bench/

Manual performance tooling, not part of the extension build. Results and method are in
[docs/devlog/2026-09-23-local-whisper-performance.md](../docs/devlog/2026-09-23-local-whisper-performance.md).

- `whisper-bench.html` — loads a `libmain.js` glue build directly in a plain page and times
  repeated `full_default` calls. Open it through `serve.mjs`, not `file://`.
- `serve.mjs` — a zero-dependency Node static server that adds the COOP/COEP headers the
  threaded build needs for `SharedArrayBuffer`. Run `node bench/serve.mjs` from the repo
  root, then open `http://localhost:8000/bench/whisper-bench.html`.
- `single-thread-full-opts.patch` — the shipping `single-thread.patch` plus a `full_opts`
  binding that takes `audio_ctx`, `max_tokens` and related options per call. It was used for
  the `audio_ctx` measurements and is not applied to the vendored build.
- `libmain-threaded.js` — **gitignored, not committed.** An experimental pthreads build. It
  can't ship alongside tab capture
  ([ADR 0001](../docs/adr/0001-single-threaded-whisper-build-to-keep-tab-capture.md)). To
  rebuild it:

  ```sh
  git clone https://github.com/emscripten-core/emsdk.git && (cd emsdk && ./emsdk install latest && ./emsdk activate latest)
  git clone https://github.com/ggml-org/whisper.cpp.git && cd whisper.cpp
  git checkout 5670d5c0bbcb148feabef84400a07cfca9aa3b30   # same commit as third_party/whisper-wasm; re-pin if that changes
  source ../emsdk/emsdk_env.sh
  ```

  Add `-s DYNAMIC_EXECUTION=0 \` to `examples/whisper.wasm/CMakeLists.txt`'s `LINK_FLAGS`,
  right after `-s FORCE_FILESYSTEM=1 \`. Change nothing else: keep `USE_PTHREADS=1`, and
  don't apply `single-thread.patch`, because upstream's detached `std::thread` works once
  real pthreads back it.

  ```sh
  emcmake cmake -B build-em -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_WASM_SINGLE_FILE=ON
  cmake --build build-em --target libmain -j 8
  cp build-em/bin/libmain.js <this repo>/bench/libmain-threaded.js
  ```

  cmake and ninja don't need root. The prebuilt binaries from
  `github.com/Kitware/CMake/releases` and `github.com/ninja-build/ninja/releases` work
  extracted anywhere on `PATH`. Built with Emscripten 6.0.10, cmake 4.4.3 and ninja 1.13.2 on
  2026-09-22.

  This build, like the production one, uses ggml's generic quantized kernels rather than the
  WASM-SIMD ones, because Emscripten's toolchain file sets `CMAKE_SYSTEM_PROCESSOR` to
  `"x86"`.

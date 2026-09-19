import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

// Ships the vendored whisper.cpp glue (see docs/whisper-wasm-provenance.md) as
// dist/whisper/libmain.js, the fixed path src/worker/main.ts loads it from. The file is
// gitignored, so a fresh clone still builds — with a warning, and ASR fails at runtime.
const whisperGlue = (): Plugin => ({
  name: "wavetype-whisper-glue",
  apply: "build",
  generateBundle() {
    const source = "third_party/whisper-wasm/libmain.js";
    if (!existsSync(source)) {
      this.warn(`${source} not found; the extension will build but cannot transcribe. See docs/whisper-wasm-provenance.md.`);
      return;
    }
    this.emitFile({ type: "asset", fileName: "whisper/libmain.js", source: readFileSync(source) });
  },
});

export default defineConfig({
  plugins: [react(), crx({ manifest }), whisperGlue()],
  server: {
    // crx's HMR client connects on a fixed port; avoid clashing with other local dev servers.
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // The offscreen document isn't referenced by any manifest field (it's created
      // at runtime via chrome.offscreen.createDocument), so crx's manifest-driven
      // HTML discovery won't find it on its own; register it as an explicit entry.
      input: {
        offscreen: "src/offscreen/index.html",
      },
    },
  },
});

import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

// Ships the vendored whisper.cpp glue (see docs/specs/whisper-wasm-provenance.md) as
// dist/whisper/libmain.js, the fixed path src/worker/main.ts loads it from. The file is
// gitignored, so a fresh clone still builds — with a warning, and ASR fails at runtime.
const whisperGlue = (): Plugin => ({
  name: "typetarget-whisper-glue",
  apply: "build",
  generateBundle() {
    const source = "third_party/whisper-wasm/libmain.js";
    if (!existsSync(source)) {
      this.warn(`${source} not found; the extension will build but cannot transcribe. See docs/specs/whisper-wasm-provenance.md.`);
      return;
    }
    this.emitFile({ type: "asset", fileName: "whisper/libmain.js", source: readFileSync(source) });
  },
});

// The licenses of TypeTarget and of the code it bundles (whisper.cpp, React, @google/genai...)
// must travel with the packaged extension, not just the repo.
const licenseFiles = (): Plugin => ({
  name: "typetarget-license-files",
  apply: "build",
  generateBundle() {
    for (const fileName of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      this.emitFile({ type: "asset", fileName, source: readFileSync(fileName) });
    }
  },
});

// Websites must not be able to tell TypeTarget is installed (docs/adr/0012-websites-cannot-detect-typetarget.md),
// so nothing is web-accessible: a listed file can be fetched from any page at a URL fixed by the
// extension id. crx lists the dynamically injected content script on all http(s) sites, and its
// manifest has no option to stop that, so the entry is removed after crx writes the manifest.
// The script doesn't need it: it is one self-contained IIFE, and executeScript({ files }) reads it
// from the package directly. Build only; the dev server's HMR needs crx's entries.
const noWebAccessibleResources = (): Plugin => ({
  name: "typetarget-no-web-accessible-resources",
  apply: "build",
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      const asset = bundle["manifest.json"];
      if (asset?.type !== "asset") {
        this.error("manifest.json was not in the bundle, so web_accessible_resources could not be removed.");
      }
      const built: Record<string, unknown> = JSON.parse(asset.source.toString());
      delete built.web_accessible_resources;
      asset.source = `${JSON.stringify(built, null, 2)}\n`;
    },
  },
});

export default defineConfig({
  plugins: [react(), crx({ manifest }), whisperGlue(), licenseFiles(), noWebAccessibleResources()],
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
      // The editor page (opened with chrome.tabs.create) likewise.
      input: {
        offscreen: "src/offscreen/index.html",
        editor: "src/editor/index.html",
      },
    },
  },
});

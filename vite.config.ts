import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
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

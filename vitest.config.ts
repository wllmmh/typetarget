import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // @crxjs/vite-plugin's `?script&iife` import (see destination-controller.ts) is
      // a build-time-only transform; Vitest doesn't run that plugin, so redirect it
      // to a stub with the same contract. See src/test/content-script-stub.ts.
      { find: /^\.\.\/content\/main\.ts\?script&iife$/, replacement: path.resolve(__dirname, "src/test/content-script-stub.ts") },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});

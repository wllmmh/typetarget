import { defineManifest, defineDynamicResource } from "@crxjs/vite-plugin";
import pkg from "./package.json";

// Permission rationale (README "Permissions" has the user-facing version):
// - tabCapture: capture audio from the source tab. Core to the feature.
// - activeTab: act on the tab where the popup was opened or a menu item chosen, without a
//   persistent host permission; also what lets tabCapture target that tab.
// - scripting: inject the destination content script on demand (activeTab-scoped) instead
//   of a persistent <all_urls> content_scripts entry.
// - storage: selected model, chunk length, API keys (local, read only to authenticate to
//   their own provider), and session-scoped tab/destination state. Never audio or transcripts.
// - offscreen: run the long-lived Web Audio + ASR pipeline outside the non-persistent service worker.
// - contextMenus: the "TypeTarget" right-click submenu. Choosing an item grants activeTab for
//   its tab. No install warning.
//
// host_permissions covers exactly the two hosted engines' APIs (gemini-live-engine.ts,
// groq-engine.ts); everything else relies on activeTab.
export default defineManifest({
  manifest_version: 3,
  name: "TypeTarget — Speech to text anywhere",
  version: pkg.version,
  description:
    "Transcribe browser tab audio directly into any text field, with your choice of AI model for free.",
  icons: {
    16: "public/icons/icon16.png",
    48: "public/icons/icon48.png",
    128: "public/icons/icon128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "public/icons/icon16.png",
      48: "public/icons/icon48.png",
      128: "public/icons/icon128.png",
    },
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  permissions: [
    "tabCapture",
    "activeTab",
    "scripting",
    "storage",
    "offscreen",
    "contextMenus"
  ],
  host_permissions: ["https://generativelanguage.googleapis.com/*", "https://api.groq.com/*"],
  // The destination content script (src/content/main.ts) is only ever injected
  // dynamically via chrome.scripting.executeScript, never declared in
  // content_scripts, so it needs no host_permissions grant; @crxjs/vite-plugin still
  // registers its built file as a web-accessible resource (required for the dynamic
  // script's own nested imports/CSS, if any are added later) — scoped explicitly here
  // rather than left at the plugin's wide-open default, even though destinations are
  // arbitrary user-chosen pages by design.
  web_accessible_resources: [defineDynamicResource({ matches: ["http://*/*", "https://*/*"] })],
  // MV3's default extension-pages CSP (script-src 'self'; object-src 'self';) does
  // not permit WebAssembly compilation. 'wasm-unsafe-eval' is the MV3-supported
  // directive for this (the older, non-standard 'wasm-eval' was MV2-only and has
  // been removed) — required for the offscreen document to instantiate whisper.cpp's
  // compiled WASM module. See
  // https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
  minimum_chrome_version: "116",
});

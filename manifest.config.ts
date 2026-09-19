import { defineManifest, defineDynamicResource } from "@crxjs/vite-plugin";
import pkg from "./package.json";

// Permission rationale (see README "Permissions" section for the user-facing version):
// - tabCapture: capture audio from the user-selected source tab. Core to the feature.
// - activeTab: lets the popup act on the current tab without a persistent host permission,
//   and grants the temporary scripting access needed to inject the destination-picker
//   content script into whatever tab the user is looking at when they click "Select destination".
// - scripting: inject/remove the destination content script programmatically (activeTab-scoped),
//   instead of declaring a persistent <all_urls> content_scripts entry.
// - storage: persist small bits of state (selected model id, destination binding) — not history,
//   not audio, not transcripts (see README "Privacy").
// - offscreen: run the long-lived Web Audio + ASR pipeline outside the non-persistent service worker.
//
// No host_permissions are declared. Destination injection relies on activeTab (granted only after
// the user clicks the extension action / a popup control) plus chrome.scripting.executeScript,
// scoped to the single tab the user is actively selecting a destination in.
// Cross-origin isolation for extension pages (incl. the offscreen document and the
// ASR worker it spawns), which is what exposes SharedArrayBuffer to whisper.cpp's
// pthreads WASM build — no browser launch flag needed. Consequence of require-corp:
// any cross-origin subresource (e.g. the Hugging Face model download) must be fetched
// with CORS, not no-cors. Defined separately and spread in because @crxjs/vite-plugin's
// manifest types don't include these (valid) Chrome manifest keys yet. See
// https://developer.chrome.com/docs/extensions/reference/manifest/cross-origin-isolation
const crossOriginIsolation = {
  cross_origin_embedder_policy: { value: "require-corp" },
  cross_origin_opener_policy: { value: "same-origin" },
};

export default defineManifest({
  manifest_version: 3,
  name: "VoiceWrite — Local Live Transcriber",
  version: pkg.version,
  description:
    "Captures a browser tab's audio and transcribes it locally with Whisper, streaming finalized text into a text field you choose. Nothing is uploaded.",
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
  permissions: ["tabCapture", "activeTab", "scripting", "storage", "offscreen"],
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
  ...crossOriginIsolation,
  minimum_chrome_version: "116",
});

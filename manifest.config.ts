import { defineManifest, defineDynamicResource } from "@crxjs/vite-plugin";
import pkg from "./package.json";

// Permission rationale (see README "Permissions" section for the user-facing version):
// - tabCapture: capture audio from the user-selected source tab. Core to the feature.
// - activeTab: lets the popup act on the current tab without a persistent host permission,
//   and grants the temporary scripting access needed to inject the destination-picker
//   content script into whatever tab the user is looking at when they click "Select destination".
// - scripting: inject/remove the destination content script programmatically (activeTab-scoped),
//   instead of declaring a persistent <all_urls> content_scripts entry.
// - storage: persist small bits of state (selected model id, destination binding, and — since
//   the Gemini engine — API keys the user pastes in) — not history, not audio, not transcripts
//   (see README "Privacy"). Keys are stored locally only and read solely to authenticate
//   requests to the provider they belong to.
// - offscreen: run the long-lived Web Audio + ASR pipeline outside the non-persistent service worker.
// - contextMenus: the "Send TypeTarget text here" item on editable fields, so an output box in any
//   tab can be picked (choosing the item grants activeTab for that tab). No install warning.
//
// host_permissions is scoped to exactly two origins: Google's Gemini API, needed for the
// optional Gemini Live transcription engine (src/worker/gemini-live-engine.ts) to open a
// WebSocket/make requests to it from the offscreen document's worker, and Groq's API for the
// optional Groq engine (src/worker/groq-engine.ts). These are real, user-visible permission
// grants that did not exist before those engines — everything else
// keeps relying on activeTab (granted only after the user clicks the extension action / a
// popup control) plus chrome.scripting.executeScript, scoped to the single tab the user is
// actively selecting a destination in.
export default defineManifest({
  manifest_version: 3,
  name: "TypeTarget — Directed Transcriber",
  version: pkg.version,
  description:
    "Captures a browser tab's audio and transcribes it — locally with Whisper by default, or optionally via Google's Gemini or Groq's API using your own key. Local mode uploads nothing.",
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

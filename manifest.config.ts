import { defineManifest } from "@crxjs/vite-plugin";
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
  minimum_chrome_version: "116",
});

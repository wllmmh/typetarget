/**
 * Extension service worker: coordination, state, and message routing only.
 * Per AGENTS.md "Offscreen document" / "Worker architecture", the actual audio
 * pipeline and ASR run in the offscreen document + worker, not here, because MV3
 * service workers are non-persistent and unsuitable for a long-lived real-time stream.
 */
import {
  envelope,
  isEnvelope,
  type BackgroundResponse,
  type CapturableTab,
  type PopupRequest,
} from "../domain/messages";
import { createInitialState } from "./state";

// Populated and read from in Phase 2+ (capture lifecycle, destination, model state).
const state = createInitialState();
console.debug("[voicewrite] service worker started", state.status);

const listCapturableTabs = async (): Promise<CapturableTab[]> => {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t): t is chrome.tabs.Tab & { id: number } => typeof t.id === "number")
    .map((t) => ({
      tabId: t.id,
      title: t.title ?? "Untitled tab",
      url: t.url ?? "",
      favIconUrl: t.favIconUrl,
    }));
};

const handlePopupRequest = async (req: PopupRequest): Promise<BackgroundResponse> => {
  switch (req.kind) {
    case "get-state":
      // Popup renders from this on open; capture/model wiring lands in later phases.
      return { kind: "ok" };
    case "list-capturable-tabs": {
      const tabs = await listCapturableTabs();
      return { kind: "capturable-tabs", tabs };
    }
    case "start-capture":
    case "stop-capture":
    case "pause-transcription":
    case "resume-transcription":
    case "begin-destination-selection":
    case "cancel-destination-selection":
    case "clear-destination":
    case "set-model":
    case "load-model":
    case "download-model":
      // Implemented in later phases (tab capture, destination selection, ASR).
      return {
        kind: "error",
        code: "not-implemented",
        message: `"${req.kind}" is not implemented yet.`,
      };
    default: {
      const _exhaustive: never = req;
      return _exhaustive;
    }
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isEnvelope<PopupRequest>(message)) return undefined;

  handlePopupRequest(message.payload)
    .then((response) => sendResponse(envelope(response)))
    .catch((err: unknown) => {
      const messageText = err instanceof Error ? err.message : "Unknown error";
      sendResponse(envelope<BackgroundResponse>({ code: "internal-error", kind: "error", message: messageText }));
    });

  return true; // keep the message channel open for the async response
});

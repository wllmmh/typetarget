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
  type ContentToBackground,
  type PopupRequest,
} from "../domain/messages";
import { createInitialState, toPublicState } from "./state";
import { CaptureController, CaptureError } from "./capture-controller";
import { DestinationController, DestinationError } from "./destination-controller";

// MV3 service workers are non-persistent: this module-level state is rebuilt from
// scratch whenever Chrome wakes the worker, so it must never be the sole record of
// anything that has to survive a worker restart mid-capture. Today capture state
// lives only here and in the offscreen document (which chrome.offscreen keeps alive
// independently of the service worker) — restoring popup-visible state after an
// unexpected worker restart during an active capture is a known Phase-7 gap, called
// out in the final report rather than silently assumed away.
const state = createInitialState();

const broadcastState = () => {
  void chrome.runtime.sendMessage(envelope<BackgroundResponse>({ kind: "state", state: toPublicState(state) }))
    // No popup may be open to receive this; that's expected, not an error.
    .catch(() => {});
};

const captureController = new CaptureController({
  onSourceTabClosed: () => {
    state.status = "error";
    state.sourceTabId = null;
    state.lastError = { code: "source-tab-closed", message: "Source tab is no longer available." };
    broadcastState();
  },
});

const destinationController = new DestinationController({
  onPicked: (ref, label) => {
    state.destination = ref;
    state.destinationLabel = label;
    state.isSelectingDestination = false;
    broadcastState();
  },
  onUnavailable: (reason) => {
    state.destination = null;
    state.destinationLabel = null;
    state.lastError = { code: "destination-unavailable", message: reason };
    broadcastState();
  },
});

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

const startCapture = async (sourceTabId: number): Promise<BackgroundResponse> => {
  try {
    await captureController.start(sourceTabId);
    state.status = "capturing";
    state.sourceTabId = sourceTabId;
    state.lastError = null;
    broadcastState();
    return { kind: "ok" };
  } catch (err) {
    const captureErr = err instanceof CaptureError ? err : new CaptureError("Unknown capture error.", "unknown");
    state.status = "error";
    state.lastError = { code: captureErr.code, message: captureErr.message };
    broadcastState();
    return { kind: "error", code: captureErr.code, message: captureErr.message };
  }
};

const stopCapture = async (): Promise<BackgroundResponse> => {
  await captureController.stop();
  state.status = "idle";
  state.sourceTabId = null;
  state.lastError = null;
  broadcastState();
  return { kind: "ok" };
};

const beginDestinationSelection = async (): Promise<BackgroundResponse> => {
  try {
    await destinationController.beginSelection();
    state.isSelectingDestination = true;
    state.lastError = null;
    broadcastState();
    return { kind: "ok" };
  } catch (err) {
    const destErr = err instanceof DestinationError ? err : new DestinationError("Unknown selection error.", "unknown");
    state.lastError = { code: destErr.code, message: destErr.message };
    broadcastState();
    return { kind: "error", code: destErr.code, message: destErr.message };
  }
};

const cancelDestinationSelection = async (): Promise<BackgroundResponse> => {
  await destinationController.cancelSelection();
  state.isSelectingDestination = false;
  broadcastState();
  return { kind: "ok" };
};

const clearDestination = (): BackgroundResponse => {
  state.destination = null;
  state.destinationLabel = null;
  broadcastState();
  return { kind: "ok" };
};

const handlePopupRequest = async (req: PopupRequest): Promise<BackgroundResponse> => {
  switch (req.kind) {
    case "get-state":
      return { kind: "state", state: toPublicState(state) };
    case "list-capturable-tabs": {
      const tabs = await listCapturableTabs();
      return { kind: "capturable-tabs", tabs };
    }
    case "start-capture":
      return startCapture(req.sourceTabId);
    case "stop-capture":
      return stopCapture();
    case "begin-destination-selection":
      return beginDestinationSelection();
    case "cancel-destination-selection":
      return cancelDestinationSelection();
    case "clear-destination":
      return clearDestination();
    case "pause-transcription":
    case "resume-transcription":
    case "set-model":
    case "load-model":
    case "download-model":
      // Implemented in later phases (ASR).
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

const CONTENT_MESSAGE_KINDS = new Set<ContentToBackground["kind"]>([
  "destination-picked",
  "destination-selection-cancelled",
  "destination-unavailable",
]);

const handleContentMessage = (msg: ContentToBackground, sender: chrome.runtime.MessageSender): void => {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  switch (msg.kind) {
    case "destination-picked":
      if (typeof tabId === "number" && typeof frameId === "number") {
        destinationController.handlePicked(tabId, frameId, msg.elementId, msg.label);
      }
      return;
    case "destination-selection-cancelled":
      state.isSelectingDestination = false;
      broadcastState();
      return;
    case "destination-unavailable":
      state.destination = null;
      state.destinationLabel = null;
      state.lastError = { code: "destination-unavailable", message: msg.reason };
      broadcastState();
      return;
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
};

const isContentMessage = (msg: unknown): msg is ContentToBackground =>
  typeof msg === "object" &&
  msg !== null &&
  "kind" in msg &&
  CONTENT_MESSAGE_KINDS.has((msg as { kind: string }).kind as ContentToBackground["kind"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isEnvelope<ContentToBackground>(message) && isContentMessage(message.payload)) {
    handleContentMessage(message.payload, sender);
    return undefined;
  }

  if (!isEnvelope<PopupRequest>(message)) return undefined;

  handlePopupRequest(message.payload)
    .then((response) => sendResponse(envelope(response)))
    .catch((err: unknown) => {
      const messageText = err instanceof Error ? err.message : "Unknown error";
      sendResponse(envelope<BackgroundResponse>({ code: "internal-error", kind: "error", message: messageText }));
    });

  return true; // keep the message channel open for the async response
});

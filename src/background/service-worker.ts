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
  type OffscreenToBackground,
  type PopupRequest,
} from "../domain/messages";
import { isFromExtensionPage } from "../domain/sender";
import type { ModelId } from "../domain/models";
import { clampChunkMs } from "../domain/tuning";
import { isPlausibleApiKey, API_KEY_PROVIDER_NAMES, type ApiKeyProvider } from "../domain/api-key";
import { createInitialState, toPublicState } from "./state";
import { pruneKnownTabs, recordKnownTab, removeKnownTab } from "./known-tabs";
import { persistState, restorePersistedState } from "./persisted-state";
import { CaptureController, CaptureError } from "./capture-controller";
import { DestinationController, DestinationError } from "./destination-controller";
import { OFFSCREEN_DOCUMENT_PATH } from "./offscreen-manager";
import { createTranscriptRouter } from "./transcript-router";
import { buildMenuModel, ContextMenu, isCapturing, MENU_OUTPUT_ID, MENU_START_STOP_ID, sourceTabIdOf } from "./context-menu";

// MV3 service workers are non-persistent: this module-level state is rebuilt from
// scratch whenever Chrome wakes the worker, so it must never be the sole record of
// anything that has to survive a worker restart mid-capture. Today capture state
// lives only here and in the offscreen document (which chrome.offscreen keeps alive
// independently of the service worker) — restoring popup-visible state after an
// unexpected worker restart during an active capture is a known Phase-7 gap, called
// out in the final report rather than silently assumed away.
const state = createInitialState();

// MV3 restarts this worker freely, so the user's picks are reloaded from storage before
// any request is answered (see persisted-state.ts).
const stateRestored = restorePersistedState(state);

/**
 * The pointer is over the destination element, per the destination's own frame
 * ("pointer-over-destination"). Chrome can't say which element a right-click menu opens on,
 * and on Linux opens it on mousedown — too early to retitle it then — so this report, which
 * arrives well before any right-click, is what lets the menu offer "Deselect output".
 */
let pointerOverDestination = false;

/** The right-click "TypeTarget" submenu; see context-menu.ts. */
const contextMenu = new ContextMenu();

const syncContextMenu = () => {
  if (!state.destination) pointerOverDestination = false;
  void contextMenu.apply(buildMenuModel(state, pointerOverDestination));
};

/** Every state change the popup sees is broadcast, so this also keeps the right-click menu in step. */
const broadcastState = () => {
  void chrome.runtime.sendMessage(envelope<BackgroundResponse>({ kind: "state", state: toPublicState(state) }))
    // No popup may be open to receive this; that's expected, not an error.
    .catch(() => {});
  syncContextMenu();
};

/** Broadcasts *and* persists: use after changing a field persisted-state.ts stores. */
const commitState = () => {
  void persistState(state);
  broadcastState();
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
    // A pick in the same frame replaces its own outline; one elsewhere (another tab, window
    // or frame) must be told to drop the old outline.
    const previous = state.destination;
    if (previous && (previous.tabId !== ref.tabId || previous.frameId !== ref.frameId)) {
      void destinationController.release(previous);
    }
    state.destination = ref;
    state.destinationLabel = label;
    state.isSelectingDestination = false;
    commitState();
  },
  onUnavailable: (reason) => {
    state.destination = null;
    state.destinationLabel = null;
    state.lastError = { code: "destination-unavailable", message: reason };
    commitState();
  },
});

const transcriptRouter = createTranscriptRouter({
  state,
  insertText: (destination, text, separator) => destinationController.insertText(destination, text, separator),
  onStateChanged: broadcastState,
});

/**
 * The tabs the popup may offer as a source: ones it has been opened on (see known-tabs.ts
 * for why Chrome allows no better list), minus any that have since been closed.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!state.knownTabs.some((t) => t.tabId === tabId) && state.pendingSourceTabId !== tabId) return;
  state.knownTabs = removeKnownTab(state.knownTabs, tabId);
  if (state.pendingSourceTabId === tabId) state.pendingSourceTabId = state.knownTabs[0]?.tabId ?? null;
  commitState();
});

const listCapturableTabs = async (): Promise<CapturableTab[]> => {
  const openTabIds = (await chrome.tabs.query({}))
    .map((t) => t.id)
    .filter((id): id is number => typeof id === "number");
  const pruned = pruneKnownTabs(state.knownTabs, openTabIds);
  if (pruned.length !== state.knownTabs.length) {
    state.knownTabs = pruned;
    void persistState(state);
  }
  return state.knownTabs;
};

/**
 * Records the tab the popup was just opened on. That invocation is what grants activeTab
 * for it — which is both what lets us read its title and what lets tabCapture target it.
 */
const registerActiveTab = async (): Promise<BackgroundResponse> => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return { kind: "ok" };

  const knownTabs = recordKnownTab(state.knownTabs, activeTab);
  if (knownTabs.length === state.knownTabs.length && knownTabs[0]?.tabId === state.knownTabs[0]?.tabId) {
    return { kind: "ok" };
  }
  state.knownTabs = knownTabs;
  // Default the source to the tab the user just came from, so the common case needs no pick.
  state.pendingSourceTabId ??= knownTabs[0]?.tabId ?? null;
  commitState();
  return { kind: "ok" };
};

const startCapture = async (sourceTabId: number): Promise<BackgroundResponse> => {
  state.status = "loading-model";
  state.lastError = null;
  state.pendingSourceTabId = sourceTabId;
  state.modelDownload = null;
  state.pipeline = null;
  state.transcript = { finals: 0, inserted: 0 };
  state.inference = null;
  commitState();
  try {
    await captureController.start(sourceTabId, state.selectedModel, state.apiKeys);
    void captureController.setChunkMs(state.chunkMs).catch(() => {});
    state.status = "capturing";
    state.sourceTabId = sourceTabId;
    state.lastError = null;
    state.modelDownload = null;
    broadcastState();
    return { kind: "ok" };
  } catch (err) {
    const captureErr = err instanceof CaptureError ? err : new CaptureError("Unknown capture error.", "unknown");
    state.status = "error";
    state.modelDownload = null;
    state.lastError = { code: captureErr.code, message: captureErr.message };
    broadcastState();
    return { kind: "error", code: captureErr.code, message: captureErr.message };
  }
};

const stopCapture = async (): Promise<BackgroundResponse> => {
  await captureController.stop();
  state.status = "idle";
  state.sourceTabId = null;
  state.modelDownload = null;
  state.lastError = null;
  broadcastState();
  return { kind: "ok" };
};

const setPaused = async (paused: boolean): Promise<BackgroundResponse> => {
  const expected = paused ? "capturing" : "paused";
  if (state.status !== expected) {
    return { kind: "error", code: "invalid-state", message: paused ? "Nothing is being transcribed." : "Transcription is not paused." };
  }
  try {
    await (paused ? captureController.pause() : captureController.resume());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not change the pause state.";
    return { kind: "error", code: err instanceof CaptureError ? err.code : "unknown", message };
  }
  state.status = paused ? "paused" : "capturing";
  broadcastState();
  return { kind: "ok" };
};

const setModel = (modelId: ModelId): BackgroundResponse => {
  if (state.status !== "idle" && state.status !== "error") {
    return { kind: "error", code: "invalid-state", message: "Stop transcribing before changing the model." };
  }
  state.selectedModel = modelId;
  commitState();
  return { kind: "ok" };
};

/**
 * Chunk length is tunable while capturing: it is forwarded to the running pipeline as well as
 * persisted, so the effect can be judged live instead of only after a restart.
 */
const setChunkMs = async (chunkMs: number): Promise<BackgroundResponse> => {
  state.chunkMs = clampChunkMs(chunkMs);
  commitState();
  if (state.status !== "idle" && state.status !== "error") {
    // Best effort: if the offscreen document has gone, the next start sends the value anyway.
    await captureController.setChunkMs(state.chunkMs).catch(() => {});
  }
  return { kind: "ok" };
};

/**
 * Unlike the model choice, an API key can be entered or changed at any time — see
 * domain/api-key.ts — and, like chunk length, is forwarded to a running session
 * instead of requiring a restart. An empty key clears whatever was stored.
 */
const setApiKey = async (provider: ApiKeyProvider, apiKey: string): Promise<BackgroundResponse> => {
  const trimmed = apiKey.trim();
  if (trimmed !== "" && !isPlausibleApiKey(trimmed)) {
    return {
      kind: "error",
      code: "invalid-api-key",
      message: `That ${API_KEY_PROVIDER_NAMES[provider]} API key looks too short.`,
    };
  }
  if (trimmed === "") delete state.apiKeys[provider];
  else state.apiKeys[provider] = trimmed;
  commitState();
  if (state.status !== "idle" && state.status !== "error") {
    await captureController.setApiKey(provider, trimmed).catch(() => {});
  }
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

void stateRestored.then(syncContextMenu);

/** The pointer can't still be over the destination once the user is in another tab or window. */
const forgetPointerOverDestination = () => {
  if (!pointerOverDestination) return;
  pointerOverDestination = false;
  syncContextMenu();
};
chrome.tabs.onActivated.addListener(forgetPointerOverDestination);
chrome.windows.onFocusChanged.addListener(forgetPointerOverDestination);

const pickFromContextMenu = async (tabId: number, frameId: number): Promise<void> => {
  try {
    await destinationController.pickFromContextMenu(tabId, frameId);
    state.isSelectingDestination = false;
    state.lastError = null;
    broadcastState();
  } catch (err) {
    const destErr = err instanceof DestinationError ? err : new DestinationError("Could not use that text box.", "unknown");
    state.isSelectingDestination = false;
    state.lastError = { code: destErr.code, message: destErr.message };
    broadcastState();
  }
};

/**
 * Each item does what the matching popup control does. Choosing any menu item grants
 * activeTab for the tab it's in, which is what lets "Select output" pick there — and,
 * same as registerActiveTab for the popup, is what first makes this tab labellable and
 * capturable at all. Recording it here means the first right-click that starts capture
 * doesn't also require a separate popup visit just to make the tab "known".
 */
const handleMenuClick = async (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined): Promise<void> => {
  await stateRestored;
  if (tab) {
    const knownTabs = recordKnownTab(state.knownTabs, tab);
    if (knownTabs.length !== state.knownTabs.length || knownTabs[0]?.tabId !== state.knownTabs[0]?.tabId) {
      state.knownTabs = knownTabs;
      state.pendingSourceTabId ??= knownTabs[0]?.tabId ?? null;
      commitState();
    }
  }
  const sourceTabId = sourceTabIdOf(info.menuItemId);
  if (sourceTabId !== null) {
    const result = setSourceTab(sourceTabId);
    if (result.kind === "error") {
      state.lastError = { code: result.code, message: result.message };
      broadcastState();
    }
    return;
  }
  if (info.menuItemId === MENU_START_STOP_ID) {
    if (isCapturing(state.status)) await stopCapture();
    else if (state.pendingSourceTabId !== null) await startCapture(state.pendingSourceTabId);
    return;
  }
  if (info.menuItemId !== MENU_OUTPUT_ID || tab?.id === undefined) return;
  const frameId = info.frameId ?? 0;
  // Decided from the destination's own report, not the title, and only for a click in its
  // frame — so a title that's out of date can never deselect from some other box.
  const { destination } = state;
  const onDestination = pointerOverDestination && destination?.tabId === tab.id && destination.frameId === frameId;
  if (onDestination) clearDestination();
  else await pickFromContextMenu(tab.id, frameId);
};

chrome.contextMenus.onClicked.addListener((info, tab) => void handleMenuClick(info, tab));

/**
 * "Select output" can only start picking in the tab it was clicked in, but users click it on
 * the source tab and then go to the tab they want to type into. While picking, follow them
 * into each tab they switch to (or window they focus) that TypeTarget can reach; for one it
 * can't, say how to pick there instead of leaving clicks to silently do nothing.
 */
const UNREACHABLE_TAB_ERROR = "selection-unreachable";

const followSelectionTo = async (tabId: number): Promise<void> => {
  await stateRestored;
  if (!destinationController.isSelecting) return;
  const reached = await destinationController.followTo(tabId);
  if (reached) {
    if (state.lastError?.code !== UNREACHABLE_TAB_ERROR) return;
    state.lastError = null;
  } else {
    state.lastError = {
      code: UNREACHABLE_TAB_ERROR,
      message: 'TypeTarget can\'t pick in that tab yet. Right-click the text box and choose TypeTarget → "Type here", or open TypeTarget on that tab and click "Select output" there.',
    };
  }
  broadcastState();
};

chrome.tabs.onActivated.addListener(({ tabId }) => void followSelectionTo(tabId));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id !== undefined) void followSelectionTo(tab.id);
  });
});

const cancelDestinationSelection = async (): Promise<BackgroundResponse> => {
  await destinationController.cancelSelection();
  state.isSelectingDestination = false;
  broadcastState();
  return { kind: "ok" };
};

const clearDestination = (): BackgroundResponse => {
  if (state.destination) void destinationController.release(state.destination);
  state.destination = null;
  state.destinationLabel = null;
  commitState();
  return { kind: "ok" };
};

/**
 * Remembers which tab the user picked as the source. Held here rather than in the popup
 * because the popup is destroyed whenever it closes — including when the user switches
 * to the tab they want to type into, which is the normal way this extension is used.
 */
const setSourceTab = (sourceTabId: number | null): BackgroundResponse => {
  if (state.status !== "idle" && state.status !== "error") {
    return { kind: "error", code: "invalid-state", message: "Stop transcribing before changing the source tab." };
  }
  state.pendingSourceTabId = sourceTabId;
  commitState();
  return { kind: "ok" };
};

const handlePopupRequest = async (req: PopupRequest): Promise<BackgroundResponse> => {
  await stateRestored;
  switch (req.kind) {
    case "get-state":
      return { kind: "state", state: toPublicState(state) };
    case "register-active-tab":
      return registerActiveTab();
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
      return setPaused(true);
    case "resume-transcription":
      return setPaused(false);
    case "set-model":
      return setModel(req.modelId);
    case "set-chunk-ms":
      return setChunkMs(req.chunkMs);
    case "set-api-key":
      return setApiKey(req.provider, req.apiKey);
    case "set-source-tab":
      return setSourceTab(req.sourceTabId);
    case "load-model":
    case "download-model":
      // The model is loaded (downloading first if needed) when capture starts.
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
  "pointer-over-destination",
  "destination-selection-cancelled",
  "destination-unavailable",
]);

const handleContentMessage = (msg: ContentToBackground, sender: chrome.runtime.MessageSender): void => {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  switch (msg.kind) {
    case "destination-picked":
      if (typeof tabId === "number" && typeof frameId === "number") {
        // Prefixed with the tab's title so the popup says which tab the box is in. Picking always
        // follows a user action that grants activeTab for this tab, so Chrome includes the title.
        const tabTitle = sender.tab?.title?.trim();
        const label = tabTitle ? `${tabTitle} — ${msg.label}` : msg.label;
        destinationController.handlePicked(tabId, frameId, msg.elementId, label);
      }
      return;
    case "destination-selection-cancelled":
      state.isSelectingDestination = false;
      broadcastState();
      return;
    case "pointer-over-destination": {
      const { destination } = state;
      if (!destination || destination.tabId !== tabId || destination.frameId !== frameId) return; // not the destination's frame
      pointerOverDestination = msg.over;
      syncContextMenu();
      return;
    }
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

const OFFSCREEN_MESSAGE_KINDS = new Set<OffscreenToBackground["kind"]>([
  "transcript-event",
  "engine-status",
  "model-download-progress",
  "pipeline-stats",
  "inference-stats",
]);

const isOffscreenMessage = (msg: unknown): msg is OffscreenToBackground =>
  typeof msg === "object" &&
  msg !== null &&
  "kind" in msg &&
  OFFSCREEN_MESSAGE_KINDS.has((msg as { kind: string }).kind as OffscreenToBackground["kind"]);

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

  if (isEnvelope<OffscreenToBackground>(message) && isOffscreenMessage(message.payload)) {
    // Text is inserted into a user-chosen page, so only the offscreen document may feed it.
    if (isFromExtensionPage(sender, OFFSCREEN_DOCUMENT_PATH)) void transcriptRouter.handle(message.payload);
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

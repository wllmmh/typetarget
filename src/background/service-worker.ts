/**
 * Extension service worker: coordination, state, and message routing only. The audio
 * pipeline and ASR run in the offscreen document and its worker, because MV3 service
 * workers are non-persistent and unsuitable for a long-lived real-time stream.
 */
import {
  envelope,
  isEnvelope,
  type BackgroundResponse,
  type CapturableTab,
  type ContentToBackground,
  type DestinationRef,
  type EditorReply,
  type EditorToBackground,
  type OffscreenToBackground,
  type PopupRequest,
  type SessionIndicator,
} from "../domain/messages";
import { isFromExtensionPage } from "../domain/sender";
import type { ModelId } from "../domain/models";
import { clampChunkMs } from "../domain/tuning";
import { isPlausibleApiKey, API_KEY_PROVIDER_NAMES, type ApiKeyProvider } from "../domain/api-key";
import { createInitialState, toPublicState } from "./state";
import { pruneKnownTabs, recordKnownTab, removeKnownTab, sameKnownTabs, updateKnownTab } from "./known-tabs";
import { persistState, restorePersistedState, restrictLocalStorageToExtension } from "./persisted-state";
import { CaptureController, CaptureError } from "./capture-controller";
import { DestinationController, DestinationError } from "./destination-controller";
import { OFFSCREEN_DOCUMENT_PATH } from "./offscreen-manager";
import { createTranscriptRouter } from "./transcript-router";
import { buildMenuModel, ContextMenu, isCapturing, MENU_LISTEN_HERE_ID, MENU_NEW_FILE_ID, MENU_OUTPUT_ID, MENU_STOP_ID, MENU_STOP_TYPING_ID } from "./context-menu";

// MV3 service workers are non-persistent: this module-level state is rebuilt from
// scratch whenever Chrome wakes the worker, so it must never be the sole record of
// anything that has to survive a worker restart mid-capture. The offscreen document
// (which chrome.offscreen keeps alive independently of this worker) owns the running
// capture; a restarted worker asks it whether it still is (see captureReattached below).
const state = createInitialState();

void restrictLocalStorageToExtension();

// MV3 restarts this worker freely, so the user's picks are reloaded from storage before
// any request is answered (see persisted-state.ts).
const persistedCapture = restorePersistedState(state);
const stateRestored: Promise<void> = persistedCapture.then(() => {});

/**
 * The pointer is over the destination element, per the destination's own frame
 * ("pointer-over-destination"). Chrome can't say which element a right-click menu opens on,
 * and on Linux opens it on mousedown — too early to retitle it then — so this report, which
 * arrives well before any right-click, is what lets the menu grey out "Type to this field" there.
 */
let pointerOverDestination = false;

/** The right-click "TypeTarget" submenu; see context-menu.ts. */
const contextMenu = new ContextMenu();

const syncContextMenu = () => {
  if (!state.destination) pointerOverDestination = false;
  void contextMenu.apply(buildMenuModel(state, pointerOverDestination));
};

/** What the destination's timer badge was last told, so only an actual change messages the page. */
let shownIndicator: { destination: DestinationRef; indicator: SessionIndicator } | null = null;

/** Only if the captured tab somehow dropped out of the known list (it is recorded before capture can start). */

const sameFrame = (a: DestinationRef, b: DestinationRef) => a.tabId === b.tabId && a.frameId === b.frameId;

/**
 * Keeps the badge above the destination's outline in step with the capture: a timer while
 * capturing, "Stopped" whenever a destination is picked but nothing is. The page ticks the
 * clock itself from `since`, so this only sends when the badge's inputs change.
 * A destination replaced within the same frame re-anchors there; one in another frame is
 * told to drop its badge.
 */
const syncSessionIndicator = () => {
  const { destination, session } = state;
  const next = destination
    ? {
        destination,
        indicator: (session
          ? { since: session.since, state: session.reconnecting ? "reconnecting" : state.status === "paused" ? "paused" : "listening" }
          : { state: "stopped" }) satisfies SessionIndicator,
      }
    : null;
  if (JSON.stringify(next) === JSON.stringify(shownIndicator)) return;
  const previous = shownIndicator;
  shownIndicator = next;
  if (previous && !(next && sameFrame(previous.destination, next.destination))) {
    void destinationController.showSessionIndicator(previous.destination, null);
  }
  if (next) void destinationController.showSessionIndicator(next.destination, next.indicator);
};

/** What the toolbar icon's badge last showed, so only a change calls chrome.action. */
let shownToolbarBadge: string | null = null;

/**
 * With "Show outline" off, the toolbar icon stands in for the badge on the page,
 * since websites can't see it: "REC" in green while capturing into an output, "II" or "..." in
 * grey while paused or reconnecting, and nothing otherwise. With them on, the page's badge
 * already shows this.
 */
const syncToolbarBadge = () => {
  const { destination, session } = state;
  const badge =
    !state.showPageIndicators && destination && session
      ? session.reconnecting
        ? { text: "...", color: "#6b7280" }
        : state.status === "paused"
          ? { text: "II", color: "#6b7280" }
          : { text: "REC", color: "#1f9d55" }
      : null;
  const key = JSON.stringify(badge);
  if (key === shownToolbarBadge) return;
  shownToolbarBadge = key;
  void chrome.action.setBadgeText({ text: badge?.text ?? "" }).catch(() => {});
  if (badge) void chrome.action.setBadgeBackgroundColor({ color: badge.color }).catch(() => {});
};

/** Every state change the popup sees is broadcast, so this also keeps the right-click menu,
 * the destination's timer badge and the toolbar badge in step. */
const broadcastState = () => {
  void chrome.runtime.sendMessage(envelope<BackgroundResponse>({ kind: "state", state: toPublicState(state) }))
    // No popup may be open to receive this; that's expected, not an error.
    .catch(() => {});
  syncContextMenu();
  syncSessionIndicator();
  syncToolbarBadge();
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
    state.session = null;
    state.lastError = { code: "source-tab-closed", message: "Source tab is no longer available." };
    commitState();
  },
});

const destinationController = new DestinationController({
  showPageIndicators: () => state.showPageIndicators,
  onPicked: (ref, label) => {
    // A pick in the same frame replaces its own outline (and carries a new-file box's text
    // itself); one elsewhere (another tab, window or frame) must be told to drop the old
    // outline. If that closes a "Type to new file" box, its text moves to the new output.
    const previous = state.destination;
    if (previous && (previous.tabId !== ref.tabId || previous.frameId !== ref.frameId)) {
      void destinationController.release(previous).then((carried) => {
        if (carried && state.destination === ref) void destinationController.insertText(ref, carried, " ");
      });
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
  onCaptureEnded: () => {
    if (!isCapturing(state.status)) return;
    void captureController.stop();
    state.status = "error";
    state.sourceTabId = null;
    state.session = null;
    state.lastError = {
      code: "capture-ended",
      message: "The source tab's audio stopped reaching TypeTarget. Start listening again to resume.",
    };
    commitState();
  },
});

/**
 * Picks a capture back up after this worker restarted mid-capture. Until it settles, the
 * restored state says idle, which would drop the offscreen document's finals (and is why
 * its messages wait on this), so everything that reads capture state awaits it.
 */
const captureReattached: Promise<void> = persistedCapture.then(async (capture) => {
  if (!capture) return;
  const running = await captureController.reattach(capture.sourceTabId).catch(() => null);
  if (running) {
    state.status = running.paused ? "paused" : "capturing";
    state.sourceTabId = capture.sourceTabId;
    state.pendingSourceTabId = capture.sourceTabId;
    state.session = capture.session;
  }
  commitState(); // either way the stored capture now matches what is actually running
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

/** Keeps each known tab's label current — the popup, context menu, and destination badge
 * all show the source tab's title, which pages like YouTube change on every video. */
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const knownTabs = updateKnownTab(state.knownTabs, tabId, change);
  if (knownTabs === state.knownTabs) return;
  state.knownTabs = knownTabs;
  commitState();
});

const listCapturableTabs = async (): Promise<CapturableTab[]> => {
  const openTabIds = (await chrome.tabs.query({}))
    .map((t) => t.id)
    .filter((id): id is number => typeof id === "number");
  const pruned = pruneKnownTabs(state.knownTabs, openTabIds);
  if (pruned.length !== state.knownTabs.length) {
    state.knownTabs = pruned;
    commitState();
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
  // The popup has no tab picker: the tab it was opened on is the one to listen to. Skipped
  // while capturing, and for tabs that can't be captured (recordKnownTab leaves them out).
  const source = !isCapturing(state.status) && knownTabs.some((t) => t.tabId === activeTab.id) ? activeTab.id : undefined;
  // Compares labels too, not just order: reopening the popup on a tab whose title changed
  // since it was recorded must refresh that title.
  const sourceChanged = source !== undefined && source !== state.pendingSourceTabId;
  if (sameKnownTabs(knownTabs, state.knownTabs) && !sourceChanged) return { kind: "ok" };
  state.knownTabs = knownTabs;
  if (source !== undefined) state.pendingSourceTabId = source;
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
  state.session = null;
  commitState();
  try {
    await captureController.start(sourceTabId, state.selectedModel, state.apiKeys);
    void captureController.setChunkMs(state.chunkMs).catch(() => {});
    state.status = "capturing";
    // A network engine restarts `since` once its connection opens (see transcript-router.ts).
    state.session = { since: Date.now(), reconnects: 0, reconnecting: null };
    state.sourceTabId = sourceTabId;
    state.lastError = null;
    state.modelDownload = null;
    commitState(); // the running capture is persisted
    return { kind: "ok" };
  } catch (err) {
    const captureErr = err instanceof CaptureError ? err : new CaptureError("Unknown capture error.", "unknown");
    state.status = "error";
    state.modelDownload = null;
    state.lastError = { code: captureErr.code, message: captureErr.message };
    commitState();
    return { kind: "error", code: captureErr.code, message: captureErr.message };
  }
};

const stopCapture = async (): Promise<BackgroundResponse> => {
  await captureController.stop();
  state.status = "idle";
  state.sourceTabId = null;
  // Stopping deselects the source too: the next Start picks a tab afresh (the output box stays).
  state.pendingSourceTabId = null;
  state.session = null;
  state.modelDownload = null;
  state.lastError = null;
  commitState(); // pendingSourceTabId is persisted
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
  commitState();
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

/** "Show outline": takes effect at once on the current output and any tab
 * still picking, not just on the next pick. */
const setShowPageIndicators = (show: boolean): BackgroundResponse => {
  state.showPageIndicators = show;
  commitState();
  void destinationController.setPageIndicators(state.destination, show);
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

void captureReattached.then(() => {
  syncContextMenu();
  syncSessionIndicator(); // a restored destination shows "Stopped" until capture starts
});

/** The pointer can't still be over the destination once the user is in another tab or window. */
const forgetPointerOverDestination = () => {
  if (!pointerOverDestination) return;
  pointerOverDestination = false;
  syncContextMenu();
};
chrome.tabs.onActivated.addListener(forgetPointerOverDestination);
chrome.windows.onFocusChanged.addListener(forgetPointerOverDestination);

/** Type to this field / Type to new file: `pick` asks the page to pick, which reports back
 * through destination-picked like any other pick. */
const pickFromContextMenu = async (pick: () => Promise<void>): Promise<void> => {
  try {
    await pick();
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

/** Starts capturing `tabId` from the menu. Works mid-capture too: the tab already being
 * captured is left alone, any other is switched to. */
const listenTo = async (tabId: number): Promise<void> => {
  if (isCapturing(state.status)) {
    if (state.pendingSourceTabId === tabId) return;
    await stopCapture();
  }
  await startCapture(tabId);
};

/**
 * Each item does what the matching popup control does. Choosing any menu item grants
 * activeTab for the tab it's in, which is what lets Type to this field pick there and,
 * as registerActiveTab does for the popup, makes the tab labellable and capturable.
 * Recording it here means starting capture from the menu needs no separate popup visit.
 */
const handleMenuClick = async (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined): Promise<void> => {
  await captureReattached;
  if (tab) {
    const knownTabs = recordKnownTab(state.knownTabs, tab);
    if (!sameKnownTabs(knownTabs, state.knownTabs)) {
      state.knownTabs = knownTabs;
      commitState();
    }
  }
  if (info.menuItemId === MENU_LISTEN_HERE_ID) {
    if (tab?.id === undefined) return;
    // recordKnownTab above skips pages that can't be captured (chrome://, extension pages).
    if (!state.knownTabs.some((known) => known.tabId === tab.id)) {
      state.lastError = { code: "tab-not-capturable", message: "TypeTarget can only listen to web pages (http or https)." };
      broadcastState();
      return;
    }
    await listenTo(tab.id);
    return;
  }
  if (info.menuItemId === MENU_STOP_ID) {
    if (isCapturing(state.status)) await stopCapture();
    return;
  }
  if (info.menuItemId === MENU_STOP_TYPING_ID) {
    if (state.destination) clearDestination({ keepNewFileField: true });
    return;
  }
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  if (info.menuItemId === MENU_NEW_FILE_ID) {
    // The new box opens with the current output's text, as Open in new tab and Type to this
    // field carry it. Copied from a page's own text box (which keeps it); moved from a new-file box.
    const text = state.destination ? await destinationController.takeText(state.destination) : null;
    if (!state.showPageIndicators) {
      // The box would itself show TypeTarget to the page, so it opens as an editor tab instead.
      await pickFromContextMenu(async () => openInNewTab(text ?? "", tabId));
      return;
    }
    await pickFromContextMenu(() => destinationController.openNewFileField(tabId, text?.trim() ? text : undefined));
    return;
  }
  if (info.menuItemId !== MENU_OUTPUT_ID) return;
  await pickFromContextMenu(() => destinationController.pickFromContextMenu(tabId, info.frameId ?? 0));
};

chrome.contextMenus.onClicked.addListener((info, tab) => void handleMenuClick(info, tab));

/**
 * "Select field" can only start picking in the tab it was clicked in, but users click it on
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
      message: 'TypeTarget can\'t pick in that tab yet. Right-click the text box and choose TypeTarget → "Type to this field", or open TypeTarget on that tab and click "Select field" there.',
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

/** Stop typing (`keepNewFileField`) leaves a "Type to new file" box on the page with its text;
 * the badge's X is what removes one. */
const clearDestination = ({ keepNewFileField = false } = {}): BackgroundResponse => {
  if (state.destination) void destinationController.release(state.destination, keepNewFileField);
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
  await captureReattached;
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
      return clearDestination({ keepNewFileField: true }); // the popup's Stop typing, same as the menu's
    case "pause-transcription":
      return setPaused(true);
    case "resume-transcription":
      return setPaused(false);
    case "set-model":
      return setModel(req.modelId);
    case "set-chunk-ms":
      return setChunkMs(req.chunkMs);
    case "set-show-page-indicators":
      return setShowPageIndicators(req.show);
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
  "stop-typing-requested",
  "open-in-new-tab",
  "minimize-requested",
]);

/** The page "Open in new tab" opens (src/editor); registered as a build input in vite.config.ts. */
const EDITOR_PAGE_PATH = "src/editor/index.html";

/** The popup (manifest `action.default_popup`), the only sender of PopupRequests. */
const POPUP_PAGE_PATH = "src/popup/index.html";

/** What each editor tab opens with, until it asks for it ("editor-ready"). */
const editorTexts = new Map<number, { text: string; originTabId: number }>();
/** The editor tab being created. Its page can ask for its text before tabs.create resolves
 * with its id, so "editor-ready" waits on this first. */
let editorOpening: Promise<void> = Promise.resolve();

const openInNewTab = (text: string, openerTabId: number): void => {
  editorOpening = (async () => {
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(EDITOR_PAGE_PATH), openerTabId });
    if (tab.id !== undefined) editorTexts.set(tab.id, { text, originTabId: openerTabId });
  })();
  editorOpening.catch((err: unknown) => {
    state.lastError = { code: "open-in-tab-failed", message: err instanceof Error ? err.message : "Could not open a new tab." };
    broadcastState();
  });
};

/** The editor tab is up: hands it its text and lets it pick its box, which replaces the current
 * output (releasing the new-file box closes it). */
const adoptEditorTab = async (tabId: number): Promise<EditorReply> => {
  await editorOpening.catch(() => {});
  const opened = editorTexts.get(tabId);
  editorTexts.delete(tabId);
  await destinationController.adoptEditorTab(tabId);
  // No Move back to page while page indicators are off: it would put the box on that page.
  const originTabId = state.showPageIndicators ? opened?.originTabId ?? null : null;
  return { kind: "editor-text", text: opened?.text ?? "", originTabId };
};

/** The editor tab's Move back to page: the "Type to new file" box reopens on the page it came
 * from, with the editor's text, and becomes the output; then that page is brought forward and
 * the editor tab closed. If the page is gone (or navigated, ending TypeTarget's access), the
 * editor stays the output and the popup says why. */
const moveBackToPage = async (editorTabId: number, originTabId: number, text: string): Promise<void> => {
  if (!state.showPageIndicators) {
    state.lastError = { code: "move-back-failed", message: "Turn on \"Show outline\" to move the text back to the page." };
    broadcastState();
    return;
  }
  try {
    await destinationController.openNewFileField(originTabId, text);
  } catch {
    state.lastError = { code: "move-back-failed", message: "Couldn't move the text back: the page it came from is closed or has changed." };
    broadcastState();
    return;
  }
  state.isSelectingDestination = false;
  state.lastError = null;
  broadcastState();
  const origin = await chrome.tabs.update(originTabId, { active: true }).catch(() => undefined);
  if (origin) await chrome.windows.update(origin.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.remove(editorTabId).catch(() => {});
};

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
    case "stop-typing-requested": {
      // Only the destination's own frame shows the X; any other sender is stale or not ours.
      const { destination } = state;
      if (!destination || destination.tabId !== tabId || destination.frameId !== frameId) return;
      clearDestination(); // like Stop typing, but the X also removes a "Type to new file" box
      return;
    }
    case "minimize-requested": {
      // Only the destination's own frame shows the button, as for stop-typing-requested.
      const { destination } = state;
      if (!destination || destination.tabId !== tabId || destination.frameId !== frameId) return;
      void (async () => {
        const text = await destinationController.takeText(destination);
        await pickFromContextMenu(() => destinationController.openNewFileField(destination.tabId, text?.trim() ? text : undefined, true));
      })();
      return;
    }
    case "open-in-new-tab": {
      // Only the destination's own frame shows the button, as for stop-typing-requested.
      const { destination } = state;
      if (!destination || destination.tabId !== tabId || destination.frameId !== frameId) return;
      openInNewTab(msg.text, destination.tabId);
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
  "connection-status",
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
    if (isFromExtensionPage(sender, OFFSCREEN_DOCUMENT_PATH)) {
      const { payload } = message;
      // Chained, so a woken worker handles them in order once it knows what is capturing.
      void captureReattached.then(() => transcriptRouter.handle(payload));
    }
    return undefined;
  }

  if (isEnvelope<EditorToBackground>(message) && message.payload.kind === "editor-ready") {
    const tabId = sender.tab?.id;
    if (!isFromExtensionPage(sender, EDITOR_PAGE_PATH) || tabId === undefined) return undefined;
    void adoptEditorTab(tabId).then((reply) => sendResponse(envelope<EditorReply>(reply)));
    return true; // keep the message channel open for the async response
  }

  if (isEnvelope<EditorToBackground>(message) && message.payload.kind === "move-back-requested") {
    const tabId = sender.tab?.id;
    if (!isFromExtensionPage(sender, EDITOR_PAGE_PATH) || tabId === undefined) return undefined;
    const { originTabId, text } = message.payload;
    void stateRestored.then(() => {
      // Only the editor that is the output shows the button; any other request is stale.
      if (state.destination?.tabId === tabId) return moveBackToPage(tabId, originTabId, text);
    });
    return undefined;
  }

  // Popup requests change keys, models and capture, so they are taken only from the popup page:
  // content scripts can message the background too, and theirs run inside arbitrary pages.
  if (!isEnvelope<PopupRequest>(message) || !isFromExtensionPage(sender, POPUP_PAGE_PATH)) return undefined;

  handlePopupRequest(message.payload)
    .then((response) => sendResponse(envelope(response)))
    .catch((err: unknown) => {
      const messageText = err instanceof Error ? err.message : "Unknown error";
      sendResponse(envelope<BackgroundResponse>({ code: "internal-error", kind: "error", message: messageText }));
    });

  return true; // keep the message channel open for the async response
});

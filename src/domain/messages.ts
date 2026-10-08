/**
 * Extension-wide message contract. Every `chrome.runtime.sendMessage` /
 * `chrome.tabs.sendMessage` payload in this codebase is one of these types.
 * Keeping this in one file means the service worker, popup, offscreen doc,
 * and content script all agree on shape without importing each other's internals.
 */

import type { ModelId } from "./models";
import type { ConnectionStatus, EngineStatus } from "./models";
import type { ApiKeyProvider } from "./api-key";
import type { InferenceStats } from "../worker/instrumented-engine";
import type { TranscriptEvent, TranscriptionStatus } from "./transcript";

export type DestinationRef = {
  tabId: number;
  frameId: number;
  /** Opaque id the content script assigns to the picked element; meaningless outside its frame. */
  elementId: string;
};

/**
 * The running capture's timer. `since` restarts whenever a network engine opens a new
 * connection (Gemini's free tier ends each one after ~10 minutes, so the engine replaces
 * it), and is simply the capture start for local engines.
 */
export type ListeningSession = {
  since: number;
  reconnects: number;
  /** Non-null while a lost connection is being re-established. */
  reconnecting: { attempt: number; reason: string } | null;
};

/** What the badge over the destination's outline shows (see content/session-badge.ts). */
export type SessionIndicator =
  | {
      state: "listening" | "paused" | "reconnecting";
      /** Title of the tab being transcribed (the source tab). */
      tabName: string;
      since: number;
    }
  /** A destination is picked but nothing is being transcribed, so there is no tab to name;
   * the timer reads 0:00. */
  | { state: "stopped" };

/**
 * Serializable view of background/state.ts's AppState, sent to the popup. Excludes
 * anything not needed for rendering (no raw DOM refs, no internal-only fields) per
 * AGENTS.md "Don't pass whole DB records to client components."
 */
export type PublicAppState = {
  status: TranscriptionStatus;
  sourceTabId: number | null;
  /** Tabs offered as a source (see background/known-tabs.ts), with their current titles. */
  knownTabs: CapturableTab[];
  /** Tab the user has picked in the popup but not started capturing yet. */
  pendingSourceTabId: number | null;
  /** Non-null only while a model is downloading, so the popup can show progress. */
  modelDownload: { receivedBytes: number; totalBytes: number } | null;
  /** Diagnostics: engine state, audio reaching the pipeline, and transcript output so far. */
  engineState: EngineStatus["state"];
  pipeline: { batches: number; droppedBatches: number; peakLevel: number } | null;
  transcript: { finals: number; inserted: number };
  inference: InferenceStats | null;
  destinationLabel: string | null;
  selectedModel: ModelId;
  /** Cap on how long one utterance grows before it is transcribed (see domain/tuning.ts). */
  chunkMs: number;
  isSelectingDestination: boolean;
  lastError: { code: string; message: string } | null;
  /** Non-null while capturing. */
  session: ListeningSession | null;
  /** Which network providers currently have a stored API key — never the keys
   * themselves (see domain/api-key.ts). Drives the API Keys dialog's "•••• saved"
   * placeholders. */
  apiKeyProviders: ApiKeyProvider[];
};

/** Popup -> background */
export type PopupRequest =
  | { kind: "get-state" }
  | { kind: "list-capturable-tabs" }
  /** Sent when the popup opens: records the tab it was opened on as capturable (see known-tabs.ts). */
  | { kind: "register-active-tab" }
  | { kind: "set-source-tab"; sourceTabId: number | null }
  | { kind: "start-capture"; sourceTabId: number }
  | { kind: "stop-capture" }
  | { kind: "pause-transcription" }
  | { kind: "resume-transcription" }
  | { kind: "begin-destination-selection" }
  | { kind: "cancel-destination-selection" }
  | { kind: "clear-destination" }
  | { kind: "set-model"; modelId: ModelId }
  | { kind: "set-chunk-ms"; chunkMs: number }
  | { kind: "load-model" }
  | { kind: "download-model" }
  /** Sets or clears (empty apiKey) the stored key for a network provider. */
  | { kind: "set-api-key"; provider: ApiKeyProvider; apiKey: string };

/** Background -> popup (response to PopupRequest, or a broadcast state change) */
export type BackgroundResponse =
  | { kind: "ok" }
  | { kind: "error"; code: string; message: string }
  | { kind: "capturable-tabs"; tabs: CapturableTab[] }
  | { kind: "state"; state: PublicAppState };

export type CapturableTab = {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
};

/**
 * Content script -> background. Note tabId/frameId are deliberately absent from
 * "destination-picked": the background listener reads those from
 * chrome.runtime.MessageSender instead of trusting a value the script asserts about
 * itself (see src/content/main.ts).
 */
export type ContentToBackground =
  | { kind: "destination-picked"; elementId: string; label: string }
  | { kind: "destination-selection-cancelled" }
  | { kind: "destination-unavailable"; reason: string }
  /** The pointer entered/left the destination element, so the right-click menu can grey out
   * "Type to this field" on it (Chrome gives no way to ask which element a menu opens on). */
  | { kind: "pointer-over-destination"; over: boolean }
  /** The X on the destination's badge: the same as the right-click menu's "Stop typing". */
  | { kind: "stop-typing-requested" }
  /** The new-file box's "Open in new tab": carry its text to an editor tab, which becomes the
   * output in its place (see src/editor/main.ts). */
  | { kind: "open-in-new-tab"; text: string };

/** Editor page (src/editor) -> background. */
export type EditorToBackground =
  /** Asks for the text it opens with, and to become the output. */
  | { kind: "editor-ready" }
  /** The badge's Move back to page: reopen the "Type to new file" box, with this text, on the
   * page the editor was opened from, and close the editor tab. */
  | { kind: "move-back-requested"; originTabId: number; text: string };

/** Background -> editor page, in reply to "editor-ready". `originTabId` is the page it was
 * opened from; the editor keeps it, so moving back still works after a service-worker restart. */
export type EditorReply = { kind: "editor-text"; text: string; originTabId: number | null };

/** Background -> content script */
export type BackgroundToContent =
  | { kind: "enter-selection-mode" }
  | { kind: "exit-selection-mode" }
  | { kind: "insert-text"; text: string; separator: string }
  | { kind: "check-destination-alive" }
  /** The user deselected this destination or picked another one; drop it and its outline. */
  | { kind: "clear-destination" }
  /** From the right-click menu: pick the text box that was right-clicked (which is focused). */
  | { kind: "pick-focused-element" }
  /** From the right-click menu's "Type to new file": open a text box over the bottom third of
   * the page and pick it (see content/new-file-field.ts). */
  | { kind: "open-new-file-field"; text?: string }
  /** Shows (or, with null, removes) the timer badge above the destination's outline. */
  | { kind: "set-session-indicator"; indicator: SessionIndicator | null };

/** Background -> offscreen document */
export type BackgroundToOffscreen =
  | { kind: "start-capture"; streamId: string }
  | { kind: "stop-capture" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "load-model"; modelId: ModelId }
  | { kind: "unload-model" }
  | { kind: "set-chunk-ms"; chunkMs: number }
  | { kind: "set-api-key"; provider: ApiKeyProvider; apiKey: string };

/** Offscreen document -> background, as a direct reply to a BackgroundToOffscreen message. */
export type OffscreenReply =
  | { kind: "ok" }
  | { kind: "error"; code: string; message: string };

/** Offscreen document -> background, unsolicited (broadcast while capture is running). */
export type OffscreenToBackground =
  | { kind: "transcript-event"; event: TranscriptEvent }
  | { kind: "model-download-progress"; modelId: ModelId; receivedBytes: number; totalBytes: number }
  /** Periodic capture-pipeline counters, so "nothing is happening" can be diagnosed. */
  | { kind: "pipeline-stats"; batches: number; droppedBatches: number; peakLevel: number }
  | { kind: "inference-stats"; stats: InferenceStats }
  | { kind: "engine-status"; status: EngineStatus }
  | { kind: "connection-status"; status: ConnectionStatus };

export const EXTENSION_MESSAGE_SOURCE = "typetarget" as const;

/** Envelope wrapping every message so unrelated extensions' broadcasts are ignored. */
export type Envelope<T> = {
  source: typeof EXTENSION_MESSAGE_SOURCE;
  payload: T;
};

export const envelope = <T>(payload: T): Envelope<T> => ({
  source: EXTENSION_MESSAGE_SOURCE,
  payload,
});

export const isEnvelope = <T>(msg: unknown): msg is Envelope<T> =>
  typeof msg === "object" &&
  msg !== null &&
  "source" in msg &&
  (msg as { source: unknown }).source === EXTENSION_MESSAGE_SOURCE &&
  "payload" in msg;

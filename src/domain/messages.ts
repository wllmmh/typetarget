/**
 * Extension-wide message contract. Every `chrome.runtime.sendMessage` /
 * `chrome.tabs.sendMessage` payload in this codebase is one of these types.
 * Keeping this in one file means the service worker, popup, offscreen doc,
 * and content script all agree on shape without importing each other's internals.
 */

import type { ModelId } from "./models";
import type { EngineStatus } from "./models";
import type { InferenceStats } from "../worker/instrumented-engine";
import type { TranscriptEvent, TranscriptionStatus } from "./transcript";

export type DestinationRef = {
  tabId: number;
  frameId: number;
  /** Opaque id the content script assigns to the picked element; meaningless outside its frame. */
  elementId: string;
};

/**
 * Serializable view of background/state.ts's AppState, sent to the popup. Excludes
 * anything not needed for rendering (no raw DOM refs, no internal-only fields) per
 * AGENTS.md "Don't pass whole DB records to client components."
 */
export type PublicAppState = {
  status: TranscriptionStatus;
  sourceTabId: number | null;
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
  | { kind: "download-model" };

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
  | { kind: "destination-unavailable"; reason: string };

/** Background -> content script */
export type BackgroundToContent =
  | { kind: "enter-selection-mode" }
  | { kind: "exit-selection-mode" }
  | { kind: "insert-text"; text: string; separator: string }
  | { kind: "check-destination-alive" };

/** Background -> offscreen document */
export type BackgroundToOffscreen =
  | { kind: "start-capture"; streamId: string }
  | { kind: "stop-capture" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "load-model"; modelId: ModelId }
  | { kind: "unload-model" }
  | { kind: "set-chunk-ms"; chunkMs: number };

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
  | { kind: "engine-status"; status: EngineStatus };

export const EXTENSION_MESSAGE_SOURCE = "wavetype" as const;

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

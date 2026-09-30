import type { ModelId } from "../domain/models";
import type { CapturableTab, DestinationRef, ListeningSession, PublicAppState } from "../domain/messages";
import { DEFAULT_MODEL, type EngineStatus } from "../domain/models";
import { CHUNK_MS_DEFAULT } from "../domain/tuning";
import type { ApiKeyProvider } from "../domain/api-key";
import type { InferenceStats } from "../worker/instrumented-engine";
import type { TranscriptionStatus } from "../domain/transcript";

/**
 * Service worker's in-memory view of extension state. MV3 service workers are
 * non-persistent, so this is rebuilt (from chrome.storage where noted) whenever the
 * worker wakes; it must never be the sole source of truth for anything that needs to
 * survive a worker restart mid-capture (see background/service-worker.ts).
 */
export type AppState = {
  status: TranscriptionStatus;
  sourceTabId: number | null;
  pendingSourceTabId: number | null;
  /** Tabs the popup has been opened on — the only ones Chrome lets us capture or label. */
  knownTabs: CapturableTab[];
  modelDownload: { receivedBytes: number; totalBytes: number } | null;
  engineState: EngineStatus["state"];
  pipeline: { batches: number; droppedBatches: number; peakLevel: number } | null;
  transcript: { finals: number; inserted: number };
  inference: InferenceStats | null;
  destination: DestinationRef | null;
  destinationLabel: string | null;
  selectedModel: ModelId;
  chunkMs: number;
  isSelectingDestination: boolean;
  lastError: { code: string; message: string } | null;
  /** Non-null while capturing; drives the listening timer (see domain/messages.ts). */
  session: ListeningSession | null;
  /** Never sent to the popup as-is (see toPublicState) — only which providers have one. */
  apiKeys: Partial<Record<ApiKeyProvider, string>>;
};

export const createInitialState = (): AppState => ({
  status: "idle",
  sourceTabId: null,
  pendingSourceTabId: null,
  knownTabs: [],
  modelDownload: null,
  engineState: "unloaded",
  pipeline: null,
  transcript: { finals: 0, inserted: 0 },
  inference: null,
  destination: null,
  destinationLabel: null,
  selectedModel: DEFAULT_MODEL,
  chunkMs: CHUNK_MS_DEFAULT,
  isSelectingDestination: false,
  lastError: null,
  session: null,
  apiKeys: {},
});

/** Strips fields the popup doesn't need (e.g. the raw DestinationRef) before sending. */
export const toPublicState = (state: AppState): PublicAppState => ({
  status: state.status,
  sourceTabId: state.sourceTabId,
  pendingSourceTabId: state.pendingSourceTabId,
  modelDownload: state.modelDownload,
  engineState: state.engineState,
  pipeline: state.pipeline,
  transcript: state.transcript,
  inference: state.inference,
  destinationLabel: state.destinationLabel,
  selectedModel: state.selectedModel,
  chunkMs: state.chunkMs,
  isSelectingDestination: state.isSelectingDestination,
  lastError: state.lastError,
  session: state.session,
  apiKeyProviders: (Object.keys(state.apiKeys) as ApiKeyProvider[]).filter((provider) => state.apiKeys[provider]),
});

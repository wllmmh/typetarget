import type { ModelId } from "../domain/models";
import type { DestinationRef, PublicAppState } from "../domain/messages";
import { DEFAULT_MODEL } from "../domain/models";
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
  destination: DestinationRef | null;
  destinationLabel: string | null;
  selectedModel: ModelId;
  isSelectingDestination: boolean;
  lastError: { code: string; message: string } | null;
};

export const createInitialState = (): AppState => ({
  status: "idle",
  sourceTabId: null,
  destination: null,
  destinationLabel: null,
  selectedModel: DEFAULT_MODEL,
  isSelectingDestination: false,
  lastError: null,
});

/** Strips fields the popup doesn't need (e.g. the raw DestinationRef) before sending. */
export const toPublicState = (state: AppState): PublicAppState => ({
  status: state.status,
  sourceTabId: state.sourceTabId,
  destinationLabel: state.destinationLabel,
  selectedModel: state.selectedModel,
  isSelectingDestination: state.isSelectingDestination,
  lastError: state.lastError,
});

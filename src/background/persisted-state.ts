/**
 * Persists the small slice of state a user shouldn't have to re-pick. The popup is
 * destroyed every time it closes (switching tabs closes it), and MV3 restarts the
 * service worker freely, so anything only held in memory is silently forgotten.
 *
 * Split by lifetime, not convenience: the model choice is a lasting preference
 * (`storage.local`), while tab ids and injected-element ids only mean anything within
 * one browser session (`storage.session`) — restoring them after a restart would point
 * at whatever tab happened to inherit the id. The running capture is session-scoped too: it
 * is what lets a restarted worker pick up a capture the offscreen document is still running.
 */
import type { DestinationRef } from "../domain/messages";
import { MODEL_CATALOG, type ModelId } from "../domain/models";
import { clampChunkMs } from "../domain/tuning";
import { API_KEY_PROVIDER_NAMES, type ApiKeyProvider } from "../domain/api-key";
import { parseKnownTabs } from "./known-tabs";
import type { CapturableTab, ListeningSession } from "../domain/messages";
import type { AppState } from "./state";

const MODEL_KEY = "selectedModel";
const CHUNK_KEY = "chunkMs";
const API_KEYS_KEY = "apiKeys";
const SESSION_KEY = "binding";

const isApiKeyProvider = (value: unknown): value is ApiKeyProvider =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(API_KEY_PROVIDER_NAMES, value);

/** Storage is untrusted input like any other boundary: keeps only known providers and
 * string values, rather than trusting whatever shape was written by an older build. */
const parseApiKeys = (value: unknown): Partial<Record<ApiKeyProvider, string>> => {
  if (typeof value !== "object" || value === null) return {};
  const result: Partial<Record<ApiKeyProvider, string>> = {};
  for (const [provider, key] of Object.entries(value as Record<string, unknown>)) {
    if (isApiKeyProvider(provider) && typeof key === "string" && key !== "") result[provider] = key;
  }
  return result;
};

/** A capture that was running (or paused) when last persisted. */
export type PersistedCapture = { sourceTabId: number; session: ListeningSession | null };

type PersistedBinding = {
  pendingSourceTabId: number | null;
  knownTabs: CapturableTab[];
  destination: DestinationRef | null;
  destinationLabel: string | null;
  capture: PersistedCapture | null;
};

const isModelId = (value: unknown): value is ModelId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(MODEL_CATALOG, value);

/** Storage is untrusted input like any other boundary: it may hold values written by an older build. */
const parseBinding = (value: unknown): PersistedBinding | null => {
  if (typeof value !== "object" || value === null) return null;
  const { pendingSourceTabId, knownTabs, destination, destinationLabel, capture } = value as Record<string, unknown>;
  return {
    pendingSourceTabId: typeof pendingSourceTabId === "number" ? pendingSourceTabId : null,
    knownTabs: parseKnownTabs(knownTabs),
    destination: isDestinationRef(destination) ? destination : null,
    destinationLabel: typeof destinationLabel === "string" ? destinationLabel : null,
    capture: parseCapture(capture),
  };
};

const parseCapture = (value: unknown): PersistedCapture | null => {
  if (typeof value !== "object" || value === null) return null;
  const { sourceTabId, session } = value as Record<string, unknown>;
  if (typeof sourceTabId !== "number") return null;
  return { sourceTabId, session: parseSession(session) };
};

/** A reconnect in progress is not restored: the engine reports its connection again anyway. */
const parseSession = (value: unknown): ListeningSession | null => {
  if (typeof value !== "object" || value === null) return null;
  const { since, reconnects } = value as Record<string, unknown>;
  if (typeof since !== "number" || typeof reconnects !== "number") return null;
  return { since, reconnects, reconnecting: null };
};

const isDestinationRef = (value: unknown): value is DestinationRef => {
  if (typeof value !== "object" || value === null) return false;
  const { tabId, frameId, elementId } = value as Record<string, unknown>;
  return typeof tabId === "number" && typeof frameId === "number" && typeof elementId === "string";
};

/**
 * `storage.local` holds the user's API keys, and unlike `storage.session` it is readable from
 * content scripts by default — which run inside arbitrary web pages. Nothing outside the
 * extension's own pages needs it, so it is restricted to them, on every worker start (harmless
 * if Chrome already kept the setting). A failure leaves the keys readable from the content
 * script; it is reported, not fatal.
 */
export const restrictLocalStorageToExtension = async (): Promise<void> => {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (err) {
    console.warn(`TypeTarget: could not restrict local storage to the extension (${err instanceof Error ? err.message : String(err)}).`);
  }
};

/**
 * Fills `state` in place from storage. Never throws: a failed restore means defaults, not a
 * broken extension. A capture that was running is returned rather than restored into `state`:
 * only the offscreen document can say whether it still is (see CaptureController.reattach).
 */
export const restorePersistedState = async (state: AppState): Promise<PersistedCapture | null> => {
  try {
    const [local, chunk, apiKeys, session] = await Promise.all([
      chrome.storage.local.get(MODEL_KEY),
      chrome.storage.local.get(CHUNK_KEY),
      chrome.storage.local.get(API_KEYS_KEY),
      chrome.storage.session.get(SESSION_KEY),
    ]);

    const model = local[MODEL_KEY];
    if (isModelId(model)) state.selectedModel = model;

    const storedChunk = chunk[CHUNK_KEY];
    if (typeof storedChunk === "number") state.chunkMs = clampChunkMs(storedChunk);

    state.apiKeys = parseApiKeys(apiKeys[API_KEYS_KEY]);

    const binding = parseBinding(session[SESSION_KEY]);
    if (binding) {
      state.pendingSourceTabId = binding.pendingSourceTabId;
      state.knownTabs = binding.knownTabs;
      state.destination = binding.destination;
      state.destinationLabel = binding.destinationLabel;
    }
    return binding?.capture ?? null;
  } catch {
    // Keep the in-memory defaults.
    return null;
  }
};

export const persistState = async (state: AppState): Promise<void> => {
  const binding: PersistedBinding = {
    pendingSourceTabId: state.pendingSourceTabId,
    knownTabs: state.knownTabs,
    destination: state.destination,
    destinationLabel: state.destinationLabel,
    capture:
      (state.status === "capturing" || state.status === "paused") && state.sourceTabId !== null
        ? { sourceTabId: state.sourceTabId, session: state.session }
        : null,
  };
  try {
    await Promise.all([
      chrome.storage.local.set({ [MODEL_KEY]: state.selectedModel, [CHUNK_KEY]: state.chunkMs, [API_KEYS_KEY]: state.apiKeys }),
      chrome.storage.session.set({ [SESSION_KEY]: binding }),
    ]);
  } catch {
    // Losing a preference is not worth failing the user's action over.
  }
};

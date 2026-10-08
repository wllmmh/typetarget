import { useEffect, useRef, useState } from "react";
import { sendToBackground } from "./background-client";
import { useBackgroundState } from "./use-background-state";
import type { PublicAppState } from "../domain/messages";
import { MODEL_CATALOG, type ModelId, type ModelInfo } from "../domain/models";
import { API_KEY_PAGES, API_KEY_PROVIDER_NAMES, type ApiKeyProvider } from "../domain/api-key";
import { CHUNK_MS_MAX, CHUNK_MS_MIN, CHUNK_MS_STEP } from "../domain/tuning";
import { formatElapsed } from "../domain/elapsed";
import "./popup.css";

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  "loading-model": "Loading model",
  capturing: "Capturing",
  transcribing: "Transcribing",
  paused: "Paused",
  error: "Error",
};

const MB = 1024 * 1024;

const ENGINE_LABEL: Record<string, string> = {
  unloaded: "not loaded",
  loading: "loading…",
  ready: "ready",
  error: "failed",
};

/** Below the energy VAD's threshold (see worker/energy-vad.ts) nothing will ever be transcribed. */
const QUIET_LEVEL = 0.02;

/**
 * A first model download is ~75-142 MB and can take a minute or more; without the byte
 * counts "Loading model" is indistinguishable from a hang (which is exactly how it read).
 */
const statusText = (state: PublicAppState): string => {
  const label = STATUS_LABEL[state.status] ?? state.status;
  const { modelDownload } = state;
  if (!modelDownload) return label;
  if (modelDownload.totalBytes <= 0) return `Downloading model (${Math.round(modelDownload.receivedBytes / MB)} MB)`;
  const percent = Math.floor((modelDownload.receivedBytes / modelDownload.totalBytes) * 100);
  return `Downloading model ${percent}% (${Math.round(modelDownload.receivedBytes / MB)}/${Math.round(modelDownload.totalBytes / MB)} MB)`;
};

/** Re-renders every second while `active`, for the listening timer. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
};

/** What the listening timer is counting, and anything the connection is doing about it. */
const sessionCaption = (state: PublicAppState): string => {
  const { session } = state;
  if (!session) return "";
  if (session.reconnecting) return `Reconnecting (attempt ${session.reconnecting.attempt})… ${session.reconnecting.reason}`;
  // Only Gemini holds a long-lived connection (and so can have reconnected); Groq is a request per utterance.
  const reconnected =
    MODEL_CATALOG[state.selectedModel].provider === "gemini-live" && session.reconnects > 0
      ? `reconnected ${session.reconnects}×`
      : "";
  return [state.status === "paused" ? "paused" : "listening", reconnected].filter(Boolean).join(" · ");
};

/**
 * Minimal inline icons (no asset files, no icon library — three shapes at 12x12).
 * `currentColor` so they follow the button's text color in both themes.
 */
const PlayIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path d="M2 1.2 L10.5 6 L2 10.8 Z" fill="currentColor" />
  </svg>
);
/** The model picker's sections: one per provider, in catalog order, so each model is listed
 * once under its provider's name instead of repeating it on every option. */
const MODEL_GROUPS: [string, ModelInfo[]][] = Object.entries(
  Object.values(MODEL_CATALOG).reduce<Record<string, ModelInfo[]>>(
    (groups, model) => ({ ...groups, [model.name]: [...(groups[model.name] ?? []), model] }),
    {},
  ),
);

const StopIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <rect x="1.5" y="1.5" width="9" height="9" fill="currentColor" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <rect x="1.5" y="1" width="3" height="10" fill="currentColor" />
    <rect x="7.5" y="1" width="3" height="10" fill="currentColor" />
  </svg>
);

const TargetIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="6" cy="6" r="1.4" fill="currentColor" />
  </svg>
);
const KeyIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 8 H14.5 M12 8 V11 M14.5 8 V10.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export const App = () => {
  const state = useBackgroundState();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Local while dragging so the readout tracks the thumb; null means "follow the background". */
  const [draggedChunkMs, setDraggedChunkMs] = useState<number | null>(null);
  const chunkCommitTimer = useRef<number | null>(null);
  const apiKeyDialogRef = useRef<HTMLDialogElement>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const now = useNow(state.session !== null);

  useEffect(() => {
    let cancelled = false;
    // Registering first: opening the popup is what grants activeTab for the current tab,
    // which is what makes it capturable and readable (see background/known-tabs.ts).
    sendToBackground({ kind: "register-active-tab" })
      .then(() => sendToBackground({ kind: "list-capturable-tabs" }))
      .then((res) => {
        if (cancelled) return;
        // The list itself arrives in the broadcast state (so titles stay current while the
        // popup is open); this request only prunes closed tabs from it.
        if (res.kind === "error") {
          setLoadError(res.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isCapturing =
    state.status === "loading-model" ||
    state.status === "capturing" ||
    state.status === "transcribing" ||
    state.status === "paused";

  const chunkMs = draggedChunkMs ?? state.chunkMs;
  const sourceTab = state.knownTabs.find((tab) => tab.tabId === state.pendingSourceTabId);

  /**
   * Debounced: a drag fires a change per step, and each one persists to storage and retunes
   * the running pipeline, which is not worth doing sixty times on the way to a value.
   */
  const handleChunkChange = (nextChunkMs: number) => {
    setDraggedChunkMs(nextChunkMs);
    if (chunkCommitTimer.current !== null) clearTimeout(chunkCommitTimer.current);
    chunkCommitTimer.current = window.setTimeout(() => {
      void sendToBackground({ kind: "set-chunk-ms", chunkMs: nextChunkMs });
    }, 200);
  };

  const handleStart = async () => {
    if (state.pendingSourceTabId === null) return;
    setBusy(true);
    setLoadError(null);
    const res = await sendToBackground({ kind: "start-capture", sourceTabId: state.pendingSourceTabId });
    if (res.kind === "error") setLoadError(res.message);
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true);
    await sendToBackground({ kind: "stop-capture" });
    setBusy(false);
  };

  const handleModelChange = async (modelId: ModelId) => {
    const res = await sendToBackground({ kind: "set-model", modelId });
    if (res.kind === "error") setLoadError(res.message);
  };

  /**
   * Commits on blur, not the chunk slider's per-keystroke debounce — a debounce
   * mid-paste makes no sense for a discrete secret. Clears the field on success so it
   * reverts to the "•••• saved" placeholder rather than leaving the raw key visible-if-
   * unmasked in the DOM longer than it has to be.
   */
  const handleApiKeyBlur = async (provider: ApiKeyProvider, input: HTMLInputElement) => {
    const apiKey = input.value;
    if (apiKey === "") return; // nothing typed; leave whatever was already stored alone
    const res = await sendToBackground({ kind: "set-api-key", provider, apiKey });
    if (res.kind === "error") {
      setApiKeyError(res.message);
      return;
    }
    setApiKeyError(null);
    input.value = "";
  };

  /** An empty key clears the stored one (see the background's setApiKey). */
  const handleApiKeyRemove = async (provider: ApiKeyProvider) => {
    const res = await sendToBackground({ kind: "set-api-key", provider, apiKey: "" });
    setApiKeyError(res.kind === "error" ? res.message : null);
  };

  const handleTogglePause = async () => {
    setBusy(true);
    setLoadError(null);
    const res = await sendToBackground({
      kind: state.status === "paused" ? "resume-transcription" : "pause-transcription",
    });
    if (res.kind === "error") setLoadError(res.message);
    setBusy(false);
  };

  /** The selected model's key provider; null for local models, whose dialog says no key is needed. */
  const { provider: modelProvider, requiresApiKey, network: sendsAudio, name: providerName } = MODEL_CATALOG[state.selectedModel];
  /**
   * Whether a local model keeps up depends on the machine, and on most it won't. An utterance
   * is at most one chunk of audio, so a call that takes longer than a chunk means this machine
   * transcribes slower than real time and the backlog grows while speech continues. Only
   * judged while capturing: the counters outlive Stop, and the model may have changed since.
   */
  const fallingBehind =
    isCapturing && modelProvider === "whisper-cpp" && (state.inference?.lastMs ?? 0) > state.chunkMs;
  const keyProvider = requiresApiKey && modelProvider !== "whisper-cpp" ? modelProvider : null;
  const keySaved = keyProvider !== null && state.apiKeyProviders.includes(keyProvider);

  const keyName = keyProvider ? `${API_KEY_PROVIDER_NAMES[keyProvider]} API key` : "API key";
  const keyLabel = keyProvider ? `${keyName}${keySaved ? " (saved)" : " (not set)"}` : "API key (none required)";

  const hasOutput = state.isSelectingDestination || state.destinationLabel !== null;

  const handleOutputAction = async (kind: "begin-destination-selection" | "cancel-destination-selection" | "clear-destination") => {
    setBusy(true);
    setLoadError(null);
    const res = await sendToBackground({ kind });
    if (res.kind === "error") setLoadError(res.message);
    setBusy(false);
  };

  return (
    <main className="popup">
      <h1 className="popup-title">
        <img src="/public/icons/icon48.png" alt="" width="20" height="20" />
        TypeTarget
      </h1>
    

      <section>
        <h2>Model</h2>
        <div className="model-row">
          <select
            value={state.selectedModel}
            disabled={isCapturing}
            onChange={(e) => handleModelChange(e.target.value as ModelId)}
          >
            {MODEL_GROUPS.map(([name, models]) => (
              <optgroup key={name} label={name}>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                    {model.approxSizeMb !== undefined ? ` (~${model.approxSizeMb} MB)` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            className={keyProvider && !keySaved ? "model-api-key-btn key-missing" : "model-api-key-btn"}
            aria-label={keyLabel}
            title={keyLabel}
            onClick={() => apiKeyDialogRef.current?.showModal()}
          >
            <KeyIcon />
          </button>
        </div>
        {sendsAudio && <p className="hint">Captured audio is sent to {providerName} using your API key.</p>}
        {fallingBehind && (
          <p className="error">
            This computer is transcribing slower than real time with this model. A Groq or Gemini model keeps up on any
            computer.
          </p>
        )}
      </section>

      <section>
        <h2 className="chunk-length-heading">
          Chunk length
          <span className="hint chunk-length-hint">{(chunkMs / 1000).toFixed(0)}s max</span>
        </h2>
        <input
          type="range"
          min={CHUNK_MS_MIN}
          max={CHUNK_MS_MAX}
          step={CHUNK_MS_STEP}
          value={chunkMs}
          onChange={(e) => handleChunkChange(Number(e.target.value))}
        />
      </section>

      <dialog ref={apiKeyDialogRef} onClose={() => setApiKeyError(null)}>
        <h2>{keyName}</h2>
        {keyProvider ? (
          <p className="hint">Stored on this device only, used solely to authenticate requests to the provider.</p>
        ) : (
          <p className="hint">No API key required</p>
        )}
        {apiKeyError && <p className="error">{apiKeyError}</p>}
        {keyProvider && (
          // Keyed by provider so a half-typed key never carries over into another provider's field.
          <input
            key={keyProvider}
            type="password"
            aria-label={`${API_KEY_PROVIDER_NAMES[keyProvider]} API key`}
            placeholder={keySaved ? "•••• saved" : `Paste your ${API_KEY_PROVIDER_NAMES[keyProvider]} API key`}
            onBlur={(e) => handleApiKeyBlur(keyProvider, e.currentTarget)}
          />
        )}
        <div className="dialog-actions">
          {keyProvider && keySaved && (
            <button type="button" onClick={() => void handleApiKeyRemove(keyProvider)}>
              Remove key
            </button>
          )}
          {keyProvider && API_KEY_PAGES[keyProvider] && (
            <button type="button" onClick={() => void chrome.tabs.create({ url: API_KEY_PAGES[keyProvider] })}>
              Get API Key
            </button>
          )}
          <button type="button" className="dialog-done" onClick={() => apiKeyDialogRef.current?.close()}>
            Done
          </button>
        </div>
      </dialog>

      <section>
        <h2>Listening to</h2>
        {loadError && <p className="error">{loadError}</p>}
        <p className="target-line">
          <span className="target-name">{sourceTab ? sourceTab.title : "No tab selected"}</span>
          {state.session && (
            <span className={`session-timer-clock${state.session.reconnecting ? " reconnecting" : ""}`} role="timer">
              {formatElapsed(now - state.session.since)}
            </span>
          )}
        </p>
        <div className="controls">
          {isCapturing ? (
            <button type="button" disabled={busy} onClick={handleStop}>
              <StopIcon /> Stop listening
            </button>
          ) : (
            <button type="button" disabled={busy || state.pendingSourceTabId === null} onClick={handleStart}>
              <PlayIcon /> Start listening
            </button>
          )}
          <button
            type="button"
            disabled={busy || (state.status !== "capturing" && state.status !== "paused")}
            onClick={handleTogglePause}
          >
            <PauseIcon /> {state.status === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      </section>

      <section>
        <h2>Typing to</h2>
        {state.isSelectingDestination && (
          <p>Click any text field to send transcribed text there.</p>
        )}
        <p className="target-name" title={state.destinationLabel ?? undefined}>
          {state.destinationLabel ?? "No field selected"}
        </p>
        <div className="controls">
          {/* While a pick is in progress this cancels it; once bound, it clears the output. */}
          <button
            type="button"
            disabled={busy || !hasOutput}
            onClick={() => handleOutputAction(state.isSelectingDestination ? "cancel-destination-selection" : "clear-destination")}
          >
            <StopIcon /> Stop typing
          </button>
          <button type="button" disabled={busy || state.isSelectingDestination} onClick={() => handleOutputAction("begin-destination-selection")}>
            <TargetIcon /> Select field
          </button>
        </div>
      </section>

      <section>
        <h2>Diagnostics</h2>
        <p>Model: {ENGINE_LABEL[state.engineState] ?? state.engineState}</p>
        {state.pipeline ? (
          <>
            <p>
              Audio: {state.pipeline.batches} chunks, level {state.pipeline.peakLevel.toFixed(3)}
            </p>
            {state.pipeline.peakLevel < QUIET_LEVEL && (
              <p className="error">
                No audible audio from that tab. Check it is actually playing and not muted.
              </p>
            )}
            {state.pipeline.droppedBatches > 0 && <p>Dropped before model ready: {state.pipeline.droppedBatches}</p>}
          </>
        ) : (
          <p>Audio: not capturing</p>
        )}
        <p>
          Transcribed: {state.transcript.finals} finals, {state.transcript.inserted} inserted
        </p>
        {state.inference && (
          <p>
            Inference: {state.inference.finished}/{state.inference.started} done
            {state.inference.failed > 0 && `, ${state.inference.failed} failed`}
            {state.inference.lastMs !== null && `, last ${(state.inference.lastMs / 1000).toFixed(1)}s`}
          </p>
        )}
        <p>Status: {statusText(state)}</p>
        {state.session && <p>Session: {sessionCaption(state)}</p>}
        {state.modelDownload && state.modelDownload.totalBytes > 0 && (
          <progress value={state.modelDownload.receivedBytes} max={state.modelDownload.totalBytes} />
        )}
        {state.lastError && <p className="error">{state.lastError.message}</p>}
      </section>
    </main>
  );
};

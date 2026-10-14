import { useEffect, useRef, useState } from "react";
import { sendToBackground } from "./background-client";
import { useBackgroundState } from "./use-background-state";
import type { PublicAppState } from "../domain/messages";
import { MODEL_CATALOG, type ModelId } from "../domain/models";
import { ModelPicker } from "./model-picker";
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

/**
 * Stands in for a saved API key in the dialog's field. The key itself never reaches the popup
 * (ADR 0007), so a saved key is shown as this; emptying the field removes it. No real key
 * contains a bullet, which is how an untouched field is told from an edited one.
 */
const SAVED_KEY_MASK = "••••••••••••";

const ENGINE_LABEL: Record<string, string> = {
  unloaded: "not loaded",
  loading: "loading…",
  ready: "ready",
  error: "failed",
};

/** Below the energy VAD's threshold (see worker/energy-vad.ts) nothing will ever be transcribed. */
const QUIET_LEVEL = 0.02;

/**
 * A first model download is tens to hundreds of MB and can take a minute or more; without
 * the byte counts "Loading model" is indistinguishable from a hang.
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
 * Minimal inline icons (no asset files, no icon library).
 * `currentColor` so they follow the button's text color in both themes.
 */
const PlayIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path d="M2 1.2 L10.5 6 L2 10.8 Z" fill="currentColor" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <rect x="1.5" y="1.5" width="9" height="9" fill="currentColor" />
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
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  /** Which provider's key the dialog edits: the one whose group header opened it, not the selected model's. */
  const [keyDialogProvider, setKeyDialogProvider] = useState<ApiKeyProvider | null>(null);
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
  // Named only while capturing: before Start, the pending tab is just whichever tab the popup opened over.
  const sourceTab = isCapturing ? state.knownTabs.find((tab) => tab.tabId === state.sourceTabId) : undefined;

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
    // Stopping clears the source tab, and the popup has no tab picker: without this, Start stays
    // disabled until the popup is reopened. It is still open over the tab it was invoked on.
    await sendToBackground({ kind: "register-active-tab" });
    setBusy(false);
  };

  const handleModelChange = async (modelId: ModelId) => {
    const res = await sendToBackground({ kind: "set-model", modelId });
    if (res.kind === "error") setLoadError(res.message);
  };

  /**
   * Commits on blur, not the chunk slider's per-keystroke debounce — a debounce
   * mid-paste makes no sense for a discrete secret. The mask means untouched, and an empty
   * field is left for Done to treat as a removal. After a save the field shows the mask again
   * rather than leaving the raw key in the DOM.
   */
  const handleApiKeyBlur = async (provider: ApiKeyProvider, input: HTMLInputElement) => {
    const apiKey = input.value;
    if (apiKey === "" || apiKey === SAVED_KEY_MASK) return;
    if (apiKey.includes("•")) {
      // Typed onto the mask instead of replacing it; no key looks like that.
      input.value = SAVED_KEY_MASK;
      return;
    }
    const res = await sendToBackground({ kind: "set-api-key", provider, apiKey });
    if (res.kind === "error") {
      setApiKeyError(res.message);
      return;
    }
    setApiKeyError(null);
    input.value = SAVED_KEY_MASK;
  };

  /**
   * Done is what removes a key: a saved key whose field has been emptied is cleared (the
   * background treats an empty key as "clear"). Leaving the dialog any other way keeps it.
   */
  const handleApiKeyDone = async () => {
    if (keyDialogProvider && keySaved && apiKeyInputRef.current?.value === "") {
      const res = await sendToBackground({ kind: "set-api-key", provider: keyDialogProvider, apiKey: "" });
      if (res.kind === "error") {
        setApiKeyError(res.message);
        return;
      }
    }
    apiKeyDialogRef.current?.close();
  };

  const { provider: modelProvider } = MODEL_CATALOG[state.selectedModel];
  /**
   * Whether a local model keeps up depends on the machine, and on most it won't. An utterance
   * is at most one chunk of audio, so a call that takes longer than a chunk means this machine
   * transcribes slower than real time and the backlog grows while speech continues. Only
   * judged while capturing: the counters outlive Stop, and the model may have changed since.
   */
  const fallingBehind =
    isCapturing && modelProvider === "whisper-cpp" && (state.inference?.lastMs ?? 0) > state.chunkMs;
  const keyDialogModel = Object.values(MODEL_CATALOG).find((model) => model.provider === keyDialogProvider);
  const keySaved = keyDialogProvider !== null && state.apiKeyProviders.includes(keyDialogProvider);

  const handleEditKey = (provider: ApiKeyProvider) => {
    setKeyDialogProvider(provider);
    // Closed without Done, an emptied field would otherwise reopen empty over a key that is still stored.
    if (apiKeyInputRef.current) {
      apiKeyInputRef.current.value = state.apiKeyProviders.includes(provider) ? SAVED_KEY_MASK : "";
    }
    apiKeyDialogRef.current?.showModal();
  };

  const hasOutput = state.destinationLabel !== null;

  /** Start typing is the right-click menu's "Type to new file", on the tab the popup opened over. */
  const handleOutputToggle = async () => {
    setBusy(true);
    setLoadError(null);
    const res = await sendToBackground({ kind: hasOutput ? "clear-destination" : "start-typing" });
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
          <ModelPicker
            value={state.selectedModel}
            disabled={isCapturing}
            savedKeyProviders={state.apiKeyProviders}
            onChange={handleModelChange}
            onEditKey={handleEditKey}
          />
        </div>
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
        {keyDialogProvider && (
          <>
            <h2>{API_KEY_PROVIDER_NAMES[keyDialogProvider]} API key</h2>
            <p className="hint">Your API key is stored on this device only, used solely to authenticate requests to the provider.</p>
            {keyDialogModel?.network && (
              <p className="hint">Audio is sent to {keyDialogModel.name} for processing.</p>
            )}
            {apiKeyError && <p className="error">{apiKeyError}</p>}
            {/* Keyed by provider so a half-typed key never carries over into another provider's field. */}
            <input
              key={keyDialogProvider}
              ref={apiKeyInputRef}
              type="password"
              aria-label={`${API_KEY_PROVIDER_NAMES[keyDialogProvider]} API key`}
              placeholder={`Paste your ${API_KEY_PROVIDER_NAMES[keyDialogProvider]} API key`}
              defaultValue={keySaved ? SAVED_KEY_MASK : ""}
              // Selected so that typing or pasting replaces the mask instead of landing after it.
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => handleApiKeyBlur(keyDialogProvider, e.currentTarget)}
            />
          </>
        )}
        <div className="dialog-actions">
          {keyDialogProvider && API_KEY_PAGES[keyDialogProvider] && (
            <button type="button" onClick={() => void chrome.tabs.create({ url: API_KEY_PAGES[keyDialogProvider] })}>
              Get API Key
            </button>
          )}
          <button type="button" className="dialog-done" onClick={() => void handleApiKeyDone()}>
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
            <button type="button" className="stop" disabled={busy} onClick={handleStop}>
              <StopIcon /> Stop listening
            </button>
          ) : (
            <button type="button" disabled={busy || state.pendingSourceTabId === null} onClick={handleStart}>
              <PlayIcon /> Start listening
            </button>
          )}
        </div>
      </section>

      <section>
        <h2>Typing to</h2>
        <p className="target-name" title={state.destinationLabel ?? undefined}>
          {state.destinationLabel ?? "No field selected"}
        </p>
        <div className="controls">
          <button type="button" className={hasOutput ? "stop" : undefined} disabled={busy} onClick={handleOutputToggle}>
            {hasOutput ? (
              <>
                <StopIcon /> Stop typing
              </>
            ) : (
              <>
                <PlayIcon /> Start typing
              </>
            )}
          </button>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={state.showPageIndicators}
            onChange={(e) => void sendToBackground({ kind: "set-show-page-indicators", show: e.target.checked })}
          />
          Show outline
        </label>
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

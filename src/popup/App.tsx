import { useEffect, useRef, useState } from "react";
import { sendToBackground } from "./background-client";
import { useBackgroundState } from "./use-background-state";
import type { CapturableTab, PublicAppState } from "../domain/messages";
import { MODEL_CATALOG, type ModelId } from "../domain/models";
import { CHUNK_MS_MAX, CHUNK_MS_MIN, CHUNK_MS_STEP } from "../domain/tuning";
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


/**
 * Minimal inline icons (no asset files, no icon library — three shapes at 12x12).
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
const PauseIcon = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <rect x="1.5" y="1" width="3" height="10" fill="currentColor" />
    <rect x="7.5" y="1" width="3" height="10" fill="currentColor" />
  </svg>
);

export const App = () => {
  const state = useBackgroundState();
  const [tabs, setTabs] = useState<CapturableTab[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Local while dragging so the readout tracks the thumb; null means "follow the background". */
  const [draggedChunkMs, setDraggedChunkMs] = useState<number | null>(null);
  const chunkCommitTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Registering first: opening the popup is what grants activeTab for the current tab,
    // which is what makes it capturable and readable (see background/known-tabs.ts).
    sendToBackground({ kind: "register-active-tab" })
      .then(() => sendToBackground({ kind: "list-capturable-tabs" }))
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "capturable-tabs") {
          setTabs(res.tabs);
        } else if (res.kind === "error") {
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

  const handleSourceTabChange = async (sourceTabId: number | null) => {
    const res = await sendToBackground({ kind: "set-source-tab", sourceTabId });
    if (res.kind === "error") setLoadError(res.message);
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

  const handleTogglePause = async () => {
    setBusy(true);
    setLoadError(null);
    const res = await sendToBackground({
      kind: state.status === "paused" ? "resume-transcription" : "pause-transcription",
    });
    if (res.kind === "error") setLoadError(res.message);
    setBusy(false);
  };

  const hasOutput = state.isSelectingDestination || state.destinationLabel !== null;

  /**
   * One toggle covers all three prior actions (begin selection / cancel selection /
   * clear a bound destination), matching the Start<->Stop toggle below: "Select output"
   * when there is none, "Deselect output" once there is — whether that's a pick in
   * progress or one already bound.
   */
  const handleToggleOutput = async () => {
    setBusy(true);
    setLoadError(null);
    const kind = state.isSelectingDestination
      ? "cancel-destination-selection"
      : state.destinationLabel !== null
        ? "clear-destination"
        : "begin-destination-selection";
    const res = await sendToBackground({ kind });
    if (res.kind === "error") setLoadError(res.message);
    setBusy(false);
  };

  return (
    <main className="popup">
      <h1>WaveType</h1>
    

      <section>
        <h2>Source tab</h2>
        {loadError && <p className="error">{loadError}</p>}
        <select
          disabled={tabs.length === 0 || isCapturing}
          value={state.pendingSourceTabId ?? ""}
          onChange={(e) => handleSourceTabChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="" disabled>
            {tabs.length === 0 ? "Open WaveType on a tab to capture it" : "Select a tab…"}
          </option>
          {tabs.map((tab) => (
            <option key={tab.tabId} value={tab.tabId}>
              {tab.title}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>Model</h2>
        <select
          value={state.selectedModel}
          disabled={isCapturing}
          onChange={(e) => handleModelChange(e.target.value as ModelId)}
        >
          {Object.values(MODEL_CATALOG).map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} (~{model.approxSizeMb} MB)
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>Chunk length</h2>
        <input
          type="range"
          min={CHUNK_MS_MIN}
          max={CHUNK_MS_MAX}
          step={CHUNK_MS_STEP}
          value={chunkMs}
          onChange={(e) => handleChunkChange(Number(e.target.value))}
        />
        <p className="hint">
          {(chunkMs / 1000).toFixed(0)}s at most per chunk — text is also sent at each pause in
          speech. Shorter gets text sooner; longer keeps up better.
        </p>
      </section>

      <section className="controls">
        {isCapturing ? (
          <button type="button" disabled={busy} onClick={handleStop}>
            <StopIcon /> Stop
          </button>
        ) : (
          <button type="button" disabled={busy || state.pendingSourceTabId === null} onClick={handleStart}>
            <PlayIcon /> Start
          </button>
        )}
        <button
          type="button"
          disabled={busy || (state.status !== "capturing" && state.status !== "paused")}
          onClick={handleTogglePause}
        >
          <PauseIcon /> {state.status === "paused" ? "Resume" : "Pause"}
        </button>
        <button type="button" disabled={busy} onClick={handleToggleOutput}>
          {hasOutput ? "Deselect output" : "Select output"}
        </button>
      </section>

      <section>
        <h2>Destination</h2>
        {state.isSelectingDestination && <p>Click a text box in the page to send transcribed text there.</p>}
        <p>{state.destinationLabel ?? "None selected"}</p>
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
      </section>

      <section>
        <h2>Status</h2>
        <p>{statusText(state)}</p>
        {state.modelDownload && state.modelDownload.totalBytes > 0 && (
          <progress value={state.modelDownload.receivedBytes} max={state.modelDownload.totalBytes} />
        )}
        {state.lastError && <p className="error">{state.lastError.message}</p>}
      </section>
    </main>
  );
};

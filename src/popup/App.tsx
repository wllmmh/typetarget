import { useEffect, useState } from "react";
import { sendToBackground } from "./background-client";
import { useBackgroundState } from "./use-background-state";
import type { CapturableTab } from "../domain/messages";
import { MODEL_CATALOG, DEFAULT_MODEL, type ModelId } from "../domain/models";
import "./popup.css";

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  "loading-model": "Loading model",
  capturing: "Capturing",
  transcribing: "Transcribing",
  paused: "Paused",
  error: "Error",
};

export const App = () => {
  const state = useBackgroundState();
  const [tabs, setTabs] = useState<CapturableTab[]>([]);
  const [selectedSourceTab, setSelectedSourceTab] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendToBackground({ kind: "list-capturable-tabs" }).then((res) => {
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

  const isCapturing = state.status === "capturing" || state.status === "transcribing" || state.status === "paused";

  const handleStart = async () => {
    if (selectedSourceTab === null) return;
    setBusy(true);
    setLoadError(null);
    const res = await sendToBackground({ kind: "start-capture", sourceTabId: selectedSourceTab });
    if (res.kind === "error") setLoadError(res.message);
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true);
    await sendToBackground({ kind: "stop-capture" });
    setBusy(false);
  };

  const handleSelectDestination = async () => {
    setBusy(true);
    setLoadError(null);
    const res = await sendToBackground({ kind: "begin-destination-selection" });
    if (res.kind === "error") setLoadError(res.message);
    setBusy(false);
  };

  const handleClearDestination = async () => {
    setBusy(true);
    await sendToBackground({ kind: "clear-destination" });
    setBusy(false);
  };

  return (
    <main className="popup">
      <h1>VoiceWrite</h1>
      <p className="privacy-note">
        Audio is processed locally in your browser. Audio is not uploaded to a server.
      </p>

      <section>
        <h2>Source tab</h2>
        {loadError && <p className="error">{loadError}</p>}
        <select
          disabled={tabs.length === 0 || isCapturing}
          value={selectedSourceTab ?? ""}
          onChange={(e) => setSelectedSourceTab(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="" disabled>
            {tabs.length === 0 ? "No tabs found" : "Select a tab…"}
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
          value={selectedModel}
          disabled={isCapturing}
          onChange={(e) => setSelectedModel(e.target.value as ModelId)}
        >
          {Object.values(MODEL_CATALOG).map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} (~{model.approxSizeMb} MB)
            </option>
          ))}
        </select>
      </section>

      <section className="controls">
        <button type="button" disabled={busy || isCapturing || selectedSourceTab === null} onClick={handleStart}>
          Start
        </button>
        <button type="button" disabled={busy || !isCapturing} onClick={handleStop}>
          Stop
        </button>
        <button type="button" disabled={busy || state.isSelectingDestination} onClick={handleSelectDestination}>
          {state.isSelectingDestination ? "Selecting…" : "Select destination"}
        </button>
      </section>

      <section>
        <h2>Destination</h2>
        {state.destinationLabel ? (
          <p>
            {state.destinationLabel}{" "}
            <button type="button" disabled={busy} onClick={handleClearDestination}>
              Clear
            </button>
          </p>
        ) : (
          <p>None selected</p>
        )}
      </section>

      <section>
        <h2>Status</h2>
        <p>{STATUS_LABEL[state.status] ?? state.status}</p>
        {state.lastError && <p className="error">{state.lastError.message}</p>}
      </section>
    </main>
  );
};

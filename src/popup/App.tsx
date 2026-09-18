import { useEffect, useState } from "react";
import { sendToBackground } from "./background-client";
import type { CapturableTab } from "../domain/messages";
import { MODEL_CATALOG, DEFAULT_MODEL, type ModelId } from "../domain/models";
import "./popup.css";

/**
 * Phase 1 popup shell: proves the popup <-> service worker messaging channel and
 * renders the tab list. Start/Stop/model-load/destination controls are wired to
 * real behavior in later phases (tab capture, destination selection, ASR); for now
 * they show a disabled state rather than silently doing nothing.
 */
export const App = () => {
  const [tabs, setTabs] = useState<CapturableTab[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <main className="popup">
      <h1>VoiceWrite</h1>
      <p className="privacy-note">
        Audio is processed locally in your browser. Audio is not uploaded to a server.
      </p>

      <section>
        <h2>Source tab</h2>
        {loadError && <p className="error">{loadError}</p>}
        <select disabled={tabs.length === 0} defaultValue="">
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
        <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as ModelId)}>
          {Object.values(MODEL_CATALOG).map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} (~{model.approxSizeMb} MB)
            </option>
          ))}
        </select>
      </section>

      <section className="controls">
        <button type="button" disabled title="Available once tab capture is implemented">
          Start
        </button>
        <button type="button" disabled title="Available once tab capture is implemented">
          Stop
        </button>
        <button type="button" disabled title="Available once destination selection is implemented">
          Select destination
        </button>
      </section>

      <section>
        <h2>Status</h2>
        <p>Idle</p>
      </section>
    </main>
  );
};

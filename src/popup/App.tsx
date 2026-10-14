import { useEffect, useRef, useState } from "react";
import { sendToBackground } from "./background-client";
import { useBackgroundState } from "./use-background-state";
import type { PublicAppState } from "../domain/messages";
import { MODEL_CATALOG, type ModelId } from "../domain/models";
import { ModelPicker } from "./model-picker";
import { NativeSelect } from "./select-box";
import { API_KEY_PAGES, API_KEY_PROVIDER_NAMES, type ApiKeyProvider } from "../domain/api-key";
import { UTTERANCE_CAP_MS } from "../domain/tuning";
import { formatElapsed } from "../domain/elapsed";
import { t, type MessageKey } from "../domain/i18n";
import { SPOKEN_LANGUAGES, SPOKEN_LANGUAGE_NAMES } from "../domain/languages";
import "./popup.css";

const STATUS_LABEL: Record<string, MessageKey> = {
  idle: "statusIdle",
  "loading-model": "statusLoadingModel",
  capturing: "statusCapturing",
  transcribing: "statusTranscribing",
  paused: "statusPaused",
  error: "statusError",
};

const MB = 1024 * 1024;

/**
 * Stands in for a saved API key in the dialog's field. The key itself never reaches the popup
 * (ADR 0007), so a saved key is shown as this; emptying the field removes it. No real key
 * contains a bullet, which is how an untouched field is told from an edited one.
 */
const SAVED_KEY_MASK = "••••••••••••";

const ENGINE_LABEL: Record<string, MessageKey> = {
  unloaded: "engineUnloaded",
  loading: "engineLoading",
  ready: "engineReady",
  error: "engineError",
};

/**
 * Every language the Whisper models can be told to expect, each by its own name, in the same
 * order whatever the UI's language: English collation, which is Unicode's default order across
 * scripts (Latin-script names first, the rest grouped by script). Not "und", which Chrome resolves
 * to the browser's language, and Japanese, for one, moves the Han-script names.
 */
const SPOKEN_LANGUAGE_OPTIONS = (() => {
  const { compare } = new Intl.Collator("en");
  return SPOKEN_LANGUAGES.map((code) => ({ code, name: SPOKEN_LANGUAGE_NAMES[code] })).sort((a, b) =>
    compare(a.name, b.name),
  );
})();

/** Below the energy VAD's threshold (see worker/energy-vad.ts) nothing will ever be transcribed. */
const QUIET_LEVEL = 0.02;

/**
 * A first model download is tens to hundreds of MB and can take a minute or more; without
 * the byte counts "Loading model" is indistinguishable from a hang.
 */
const statusText = (state: PublicAppState): string => {
  const labelKey = STATUS_LABEL[state.status];
  const label = labelKey ? t(labelKey) : state.status;
  const { modelDownload } = state;
  if (!modelDownload) return label;
  if (modelDownload.totalBytes <= 0) return t("statusDownloading", Math.round(modelDownload.receivedBytes / MB));
  const percent = Math.floor((modelDownload.receivedBytes / modelDownload.totalBytes) * 100);
  return t(
    "statusDownloadingPercent",
    percent,
    Math.round(modelDownload.receivedBytes / MB),
    Math.round(modelDownload.totalBytes / MB),
  );
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
  if (session.reconnecting) return t("sessionReconnecting", session.reconnecting.attempt, session.reconnecting.reason);
  // Only Gemini holds a long-lived connection (and so can have reconnected); Groq is a request per utterance.
  const reconnected =
    MODEL_CATALOG[state.selectedModel].provider === "gemini-live" && session.reconnects > 0
      ? t("sessionReconnected", session.reconnects)
      : "";
  return [t(state.status === "paused" ? "sessionPaused" : "sessionListening"), reconnected].filter(Boolean).join(" · ");
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

  // Named only while capturing: before Start, the pending tab is just whichever tab the popup opened over.
  const sourceTab = isCapturing ? state.knownTabs.find((tab) => tab.tabId === state.sourceTabId) : undefined;

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

  /** Applies while listening, from the next utterance. "" is Auto. */
  const handleSpokenLanguageChange = async (value: string) => {
    const res = await sendToBackground({ kind: "set-spoken-language", language: value === "" ? null : value });
    if (res.kind === "error") setLoadError(res.message);
  };

  const handleModelChange = async (modelId: ModelId) => {
    const res = await sendToBackground({ kind: "set-model", modelId });
    if (res.kind === "error") setLoadError(res.message);
  };

  /**
   * Commits on blur, not per keystroke: a key is a discrete secret, and saving it mid-paste
   * makes no sense. The mask means untouched, and an empty
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
  /** Gemini detects the spoken language itself and takes no setting for it. */
  const spokenLanguageSettable = modelProvider !== "gemini-live";
  /**
   * Whether a local model keeps up depends on the machine, and on most it won't. A call slower
   * than the base cap means the worker is stretching the cap to keep up (domain/tuning.ts), so
   * text arrives further behind the speaker than on a faster machine. Only judged while
   * capturing: the counters outlive Stop, and the model may have changed since.
   */
  const fallingBehind =
    isCapturing && modelProvider === "whisper-cpp" && (state.inference?.lastMs ?? 0) > UTTERANCE_CAP_MS;
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
  const engineLabel = ENGINE_LABEL[state.engineState];

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
        <h2>{t("modelHeading")}</h2>
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
          <p className="error">{t("fallingBehind")}</p>
        )}
      </section>

      <section>
        <h2 id="spoken-language-heading">{t("spokenLanguageHeading")}</h2>
        <NativeSelect
          aria-labelledby="spoken-language-heading"
          // Shows Auto for Gemini without touching the saved choice, which returns with a Whisper model.
          value={spokenLanguageSettable ? (state.spokenLanguage ?? "") : ""}
          disabled={!spokenLanguageSettable}
          onChange={(e) => void handleSpokenLanguageChange(e.target.value)}
        >
          <option value="">{t("spokenLanguageAuto")}</option>
          {SPOKEN_LANGUAGE_OPTIONS.map(({ code, name }) => (
            // lang: each name is in its own language, for screen readers and the right font.
            <option key={code} value={code} lang={code}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </section>

      <dialog ref={apiKeyDialogRef} onClose={() => setApiKeyError(null)}>
        {keyDialogProvider && (
          <>
            <h2>{t("apiKeyTitle", API_KEY_PROVIDER_NAMES[keyDialogProvider])}</h2>
            <p className="hint">{t("apiKeyStorageNote")}</p>
            {keyDialogModel?.network && <p className="hint">{t("apiKeyNetworkNote", keyDialogModel.name)}</p>}
            {apiKeyError && <p className="error">{apiKeyError}</p>}
            {/* Keyed by provider so a half-typed key never carries over into another provider's field. */}
            <input
              key={keyDialogProvider}
              ref={apiKeyInputRef}
              type="password"
              aria-label={t("apiKeyTitle", API_KEY_PROVIDER_NAMES[keyDialogProvider])}
              placeholder={t("apiKeyPlaceholder", API_KEY_PROVIDER_NAMES[keyDialogProvider])}
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
              {t("getApiKey")}
            </button>
          )}
          <button type="button" className="dialog-done" onClick={() => void handleApiKeyDone()}>
            {t("done")}
          </button>
        </div>
      </dialog>

      <section>
        <h2>{t("listeningToHeading")}</h2>
        {loadError && <p className="error">{loadError}</p>}
        <p className="target-line">
          <span className="target-name" dir="auto">
            {sourceTab ? sourceTab.title : t("noTabSelected")}
          </span>
          {state.session && (
            <span className={`session-timer-clock${state.session.reconnecting ? " reconnecting" : ""}`} role="timer">
              {formatElapsed(now - state.session.since)}
            </span>
          )}
        </p>
        <div className="controls">
          {isCapturing ? (
            <button type="button" className="stop" disabled={busy} onClick={handleStop}>
              <StopIcon /> {t("stopListening")}
            </button>
          ) : (
            <button type="button" disabled={busy || state.pendingSourceTabId === null} onClick={handleStart}>
              <PlayIcon /> {t("startListening")}
            </button>
          )}
        </div>
      </section>

      <section>
        <h2>{t("typingToHeading")}</h2>
        <p className="target-name" dir="auto" title={state.destinationLabel ?? undefined}>
          {state.destinationLabel ?? t("noFieldSelected")}
        </p>
        <div className="controls">
          <button type="button" className={hasOutput ? "stop" : undefined} disabled={busy} onClick={handleOutputToggle}>
            {hasOutput ? (
              <>
                <StopIcon /> {t("stopTyping")}
              </>
            ) : (
              <>
                <PlayIcon /> {t("startTyping")}
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
          {t("showOutline")}
        </label>
      </section>

      <section>
        <h2>{t("diagnosticsHeading")}</h2>
        <p>{t("diagnosticsModel", engineLabel ? t(engineLabel) : state.engineState)}</p>
        {state.pipeline ? (
          <>
            <p>{t("diagnosticsAudio", state.pipeline.batches, state.pipeline.peakLevel.toFixed(3))}</p>
            {state.pipeline.peakLevel < QUIET_LEVEL && (
              <p className="error">{t("diagnosticsNoAudio")}</p>
            )}
            {state.pipeline.droppedBatches > 0 && <p>{t("diagnosticsDropped", state.pipeline.droppedBatches)}</p>}
          </>
        ) : (
          <p>{t("diagnosticsAudioIdle")}</p>
        )}
        <p>{t("diagnosticsTranscribed", state.transcript.finals, state.transcript.inserted)}</p>
        {state.inference && (
          <p>
            {t("diagnosticsInference", state.inference.finished, state.inference.started)}
            {state.inference.failed > 0 && t("diagnosticsInferenceFailed", state.inference.failed)}
            {state.inference.lastMs !== null && t("diagnosticsInferenceLast", (state.inference.lastMs / 1000).toFixed(1))}
          </p>
        )}
        <p>{t("diagnosticsStatus", statusText(state))}</p>
        {state.session && <p>{t("diagnosticsSession", sessionCaption(state))}</p>}
        {state.modelDownload && state.modelDownload.totalBytes > 0 && (
          <progress value={state.modelDownload.receivedBytes} max={state.modelDownload.totalBytes} />
        )}
        {state.lastError && <p className="error">{state.lastError.message}</p>}
      </section>
    </main>
  );
};

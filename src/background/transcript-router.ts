/**
 * Routes what the offscreen document reports (transcript events, engine status) to the
 * rest of the extension: finalized text goes to the chosen destination, problems go to
 * the popup-visible state. Transcript generation (worker) and DOM insertion (content
 * script) never talk to each other directly — this is the seam between them.
 */
import type { DestinationRef, OffscreenToBackground } from "../domain/messages";
import type { AppState } from "./state";

/** Prefix used between consecutive finals; the content script omits it for the first insertion into an empty boundary. */
const FINAL_SEPARATOR = " ";

export type TranscriptRouterDeps = {
  state: AppState;
  insertText: (destination: DestinationRef, text: string, separator: string) => Promise<void>;
  /** Call after mutating `state` so the popup re-renders. */
  onStateChanged: () => void;
  /** The captured stream ended by itself; the offscreen document has already stopped it. */
  onCaptureEnded: () => void;
};

export type TranscriptRouter = {
  handle: (message: OffscreenToBackground) => Promise<void>;
};

export const createTranscriptRouter = ({ state, insertText, onStateChanged, onCaptureEnded }: TranscriptRouterDeps): TranscriptRouter => {
  // Finals must reach the destination in the order they were produced, so insertions
  // are chained rather than fired independently. The chain is kept in a resolved state
  // (see the catch below) so one failure cannot kill everything after it.
  let insertions: Promise<void> = Promise.resolve();

  const reportError = (code: string, message: string) => {
    if (state.lastError?.code === code && state.lastError.message === message) return;
    state.lastError = { code, message };
    onStateChanged();
  };

  const handle = async (message: OffscreenToBackground): Promise<void> => {
    switch (message.kind) {
      case "transcript-event": {
        const { event } = message;
        switch (event.type) {
          case "final": {
            // Stopping flushes the transcriber, and inference runs slower than real time, so
            // finals of the stopped session keep arriving; they must not be typed after Stop.
            if (state.status === "idle") return;
            const { destination } = state;
            if (!destination) {
              reportError("no-destination", "Select a destination to receive the transcribed text.");
              return;
            }
            state.transcript = { ...state.transcript, finals: state.transcript.finals + 1 };
            // The catch is what keeps the chain alive: a rejected link would otherwise
            // propagate to every later final, silently dropping the rest of the transcript.
            insertions = insertions
              .then(async () => {
                if (state.status === "idle") return; // stopped while this one waited its turn
                await insertText(destination, event.text, FINAL_SEPARATOR);
                state.transcript = { ...state.transcript, inserted: state.transcript.inserted + 1 };
              })
              .catch((err: unknown) => {
                reportError("insert-failed", err instanceof Error ? err.message : "Could not insert the transcribed text.");
              });
            onStateChanged();
            await insertions;
            return;
          }
          case "error":
            reportError(event.code, event.message);
            return;
          case "partial": // Only finalized text is inserted; partials are not surfaced yet.
          case "status":
            return;
          default: {
            const _exhaustive: never = event;
            return _exhaustive;
          }
        }
      }
      case "model-download-progress": {
        const { receivedBytes, totalBytes } = message;
        state.modelDownload = { receivedBytes, totalBytes };
        onStateChanged();
        return;
      }
      case "pipeline-stats": {
        const { batches, droppedBatches, peakLevel } = message;
        state.pipeline = { batches, droppedBatches, peakLevel };
        onStateChanged();
        return;
      }
      case "inference-stats":
        state.inference = message.stats;
        onStateChanged();
        return;
      case "engine-status":
        state.engineState = message.status.state;
        // The download is over either way once the engine reaches a terminal state.
        if (message.status.state === "ready" || message.status.state === "error") state.modelDownload = null;
        if (message.status.state === "error") {
          // An engine error is past retrying (network engines retry internally first), so the timer stops.
          state.session = null;
          reportError("model-load-failed", message.status.message);
        } else onStateChanged();
        return;
      case "connection-status": {
        // Only a running capture has a timer; the engine can reconnect while idle, too.
        if (!state.session) return;
        const { status } = message;
        state.session =
          status.state === "connected"
            ? { since: status.since, reconnects: status.reconnects, reconnecting: null }
            : { ...state.session, reconnecting: { attempt: status.attempt, reason: status.reason } };
        onStateChanged();
        return;
      }
      case "capture-ended":
        onCaptureEnded();
        return;
      default: {
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  };

  return { handle };
};

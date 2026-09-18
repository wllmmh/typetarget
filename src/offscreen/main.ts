import {
  envelope,
  isEnvelope,
  type BackgroundToOffscreen,
  type OffscreenReply,
} from "../domain/messages";
import { startTabCapture, type StartCaptureResult } from "./capture";

let active: StartCaptureResult | null = null;

const handleMessage = async (msg: BackgroundToOffscreen): Promise<OffscreenReply> => {
  switch (msg.kind) {
    case "start-capture": {
      active?.stop();
      try {
        active = await startTabCapture(msg.streamId);
        return { kind: "ok" };
      } catch (err) {
        active = null;
        const message = err instanceof Error ? err.message : "Unknown capture error.";
        return { kind: "error", code: "capture-failed", message };
      }
    }
    case "stop-capture": {
      active?.stop();
      active = null;
      return { kind: "ok" };
    }
    case "pause":
    case "resume":
    case "load-model":
    case "unload-model":
      // ASR wiring lands in Phase 4/5; capture-only for now.
      return { kind: "ok" };
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isEnvelope<BackgroundToOffscreen>(message)) return undefined;
  handleMessage(message.payload).then((reply) => sendResponse(envelope(reply)));
  return true; // keep the channel open for the async reply
});

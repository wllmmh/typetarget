/**
 * Wires background messages (enter/exit selection mode, insert text, check-alive) to
 * the destination session — exactly once per frame, however many times the script is
 * injected into it.
 *
 * chrome.scripting.executeScript re-runs the whole file on every call, and the user
 * re-enters selection mode every time they choose an output. Without this guard a
 * frame accumulates one DestinationSession and one onMessage listener per injection,
 * and every one of them that still holds a live element inserts the same final into
 * the page — which is the "text arrives twice, or three times" bug. The flag lives on
 * the isolated world's global object, which every execution of the script in this
 * frame shares.
 */
import { isEnvelope, envelope, type BackgroundToContent, type ContentToBackground } from "../domain/messages";
import { destinationSession } from "./destination-session";

/** Exported so the test can clear it; nothing else should read it. */
export const CONTENT_BRIDGE_FLAG = "__waveTypeContentBridgeInstalled" as const;

type GuardedGlobal = typeof globalThis & Record<typeof CONTENT_BRIDGE_FLAG, boolean | undefined>;

const sendToBackground = (msg: ContentToBackground) => {
  void chrome.runtime.sendMessage(envelope(msg));
};

/** Returns false if this frame was already wired up by an earlier injection. */
export const installContentBridge = (): boolean => {
  const world = globalThis as GuardedGlobal;
  if (world[CONTENT_BRIDGE_FLAG]) return false;
  world[CONTENT_BRIDGE_FLAG] = true;

  destinationSession.onPicked = (destination) => {
    // frameId/tabId are not included here: the background listener reads them off
    // chrome.runtime.MessageSender (sender.frameId / sender.tab.id), which Chrome
    // populates authoritatively — a value this script claimed about itself couldn't
    // be trusted for the same reason page-supplied data never is.
    sendToBackground({
      kind: "destination-picked",
      elementId: destination.elementId,
      label: destination.label,
    });
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isEnvelope<BackgroundToContent>(message)) return undefined;
    const msg = message.payload;

    switch (msg.kind) {
      case "enter-selection-mode":
        destinationSession.startSelecting();
        sendResponse(envelope({ kind: "ok" } as const));
        return undefined;
      case "exit-selection-mode":
        destinationSession.stopSelecting();
        sendResponse(envelope({ kind: "ok" } as const));
        return undefined;
      case "insert-text": {
        const ok = destinationSession.insert(msg.text, msg.separator);
        if (!ok) {
          sendToBackground({ kind: "destination-unavailable", reason: "Destination element is no longer available." });
        }
        sendResponse(envelope({ kind: "ok" } as const));
        return undefined;
      }
      case "check-destination-alive": {
        if (!destinationSession.isDestinationAlive()) {
          sendToBackground({ kind: "destination-unavailable", reason: "Destination element is no longer available." });
        }
        sendResponse(envelope({ kind: "ok" } as const));
        return undefined;
      }
      default: {
        const _exhaustive: never = msg;
        return _exhaustive;
      }
    }
  });

  return true;
};

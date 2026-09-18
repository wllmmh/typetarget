/**
 * Content script entry: bridges background messages (enter/exit selection mode,
 * insert text, check-alive) to the destination session. Injected on demand via
 * chrome.scripting (activeTab-scoped) rather than declared as a persistent
 * content_scripts entry — see AGENTS.md "Content script permissions".
 */
import { isEnvelope, envelope, type BackgroundToContent, type ContentToBackground } from "../domain/messages";
import { destinationSession } from "./destination-session";

const sendToBackground = (msg: ContentToBackground) => {
  void chrome.runtime.sendMessage(envelope(msg));
};

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

import { useEffect, useState } from "react";
import { sendToBackground } from "./background-client";
import { isEnvelope, type BackgroundResponse, type PublicAppState } from "../domain/messages";
import { createInitialState, toPublicState } from "../background/state";

const initialPublicState = toPublicState(createInitialState());

/**
 * Fetches current state on mount and stays in sync with the service worker's
 * broadcasts (state changes while the popup is open — e.g. source tab closing).
 */
export const useBackgroundState = () => {
  const [state, setState] = useState<PublicAppState>(initialPublicState);

  useEffect(() => {
    let cancelled = false;
    sendToBackground({ kind: "get-state" }).then((res) => {
      if (!cancelled && res.kind === "state") setState(res.state);
    });

    const onMessage = (message: unknown) => {
      if (!isEnvelope<BackgroundResponse>(message)) return;
      if (message.payload.kind === "state") setState(message.payload.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);

    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  return state;
};

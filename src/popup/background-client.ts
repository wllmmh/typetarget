import { envelope, isEnvelope, type BackgroundResponse, type PopupRequest } from "../domain/messages";

/** Thin typed wrapper around chrome.runtime.sendMessage for the popup -> background channel. */
export const sendToBackground = async (request: PopupRequest): Promise<BackgroundResponse> => {
  const raw = await chrome.runtime.sendMessage(envelope(request));
  if (!isEnvelope<BackgroundResponse>(raw)) {
    return { kind: "error", code: "bad-response", message: "Background returned an unrecognized response." };
  }
  return raw.payload;
};

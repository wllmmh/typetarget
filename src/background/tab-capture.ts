/**
 * Wraps `chrome.tabCapture.getMediaStreamId`, the MV3-correct entry point for tab
 * capture from a service worker (Chrome >=116; `tabCapture.capture()` itself is
 * "Foreground only" and unavailable here — see
 * https://developer.chrome.com/docs/extensions/reference/api/tabCapture). The
 * returned stream id is handed to the offscreen document, which is same-origin/
 * same-render-process with the service worker as of Chrome 116, so it can consume
 * the id via getUserMedia.
 *
 * `targetTabId` requires the extension to hold activeTab on that tab, which is why
 * capture must be started from a user gesture in the popup (see AGENTS.md "Capture
 * flow": "The extension must require an explicit user action before starting
 * capture.").
 */
export const getTabCaptureStreamId = (targetTabId: number): Promise<string> =>
  new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const { lastError } = chrome.runtime;
      if (lastError || !streamId) {
        reject(new Error(lastError?.message ?? "Chrome did not return a tab capture stream id."));
        return;
      }
      resolve(streamId);
    });
  });

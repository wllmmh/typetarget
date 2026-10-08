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
 * capture can only start from a user action (the popup or the right-click menu).
 */
/**
 * Chrome's own wording for a missing activeTab grant ("Extension has not been invoked for
 * the current page...") doesn't tell anyone what to do, and this is the single most likely
 * way capture fails: the grant only exists for tabs the toolbar button was clicked on.
 */
const explain = (chromeMessage: string): string =>
  chromeMessage.includes("has not been invoked")
    ? "Chrome hasn't granted TypeTarget access to that tab. Switch to it, click the TypeTarget toolbar button there, then press Start."
    : `Chrome refused to capture that tab. (${chromeMessage})`;

export const getTabCaptureStreamId = (targetTabId: number): Promise<string> =>
  new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const { lastError } = chrome.runtime;
      if (lastError || !streamId) {
        reject(new Error(explain(lastError?.message ?? "Chrome did not return a tab capture stream id.")));
        return;
      }
      resolve(streamId);
    });
  });

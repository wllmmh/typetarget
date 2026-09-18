/**
 * Chrome's `chromeMediaSource`/`chromeMediaSourceId` constraint shape is a
 * long-standing Chrome-only extension to `getUserMedia` (used for tabCapture,
 * desktopCapture, etc.) that was never standardized and isn't in the DOM lib's
 * `MediaTrackConstraints` type. This is the documented boundary where Chrome's API
 * diverges from the W3C type — see
 * https://developer.chrome.com/docs/extensions/reference/api/tabCapture and Chrome's
 * own sample (functional-samples/sample.tabcapture-recorder) for the exact shape.
 */
export type ChromeTabCaptureConstraints = MediaStreamConstraints & {
  audio: {
    mandatory: {
      chromeMediaSource: "tab";
      chromeMediaSourceId: string;
    };
  };
};

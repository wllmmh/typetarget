/**
 * Wraps a download-progress callback so it fires at most once per whole percent (plus
 * once on completion). `ensureModelDownloaded` reports every chunk, which for a ~142 MB
 * model is thousands of callbacks — each one would otherwise become a postMessage to the
 * offscreen document and a chrome.runtime broadcast to the service worker and popup.
 */
import type { DownloadProgress } from "./model-downloader";

export const createDownloadProgressReporter = <T extends DownloadProgress>(
  emit: (progress: T) => void,
): ((progress: T) => void) => {
  let lastPercent = -1;

  return (progress) => {
    const { receivedBytes, totalBytes } = progress;
    // Unknown total (no content-length): nothing to compute a percent from, so report
    // every chunk rather than going silent for the whole download.
    if (totalBytes <= 0) {
      emit(progress);
      return;
    }

    const percent = Math.floor((receivedBytes / totalBytes) * 100);
    const isComplete = receivedBytes >= totalBytes;
    if (percent === lastPercent && !isComplete) return;

    lastPercent = percent;
    emit(progress);
  };
};

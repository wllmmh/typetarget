/**
 * Owns the tab-capture MediaStream and the single long-lived AudioContext for the
 * offscreen document's audio pipeline. The AudioContext is created once and reused across
 * start/stop cycles, and the captured stream is always played back to the speakers so the
 * source tab never goes silent.
 *
 * This module knows nothing about Whisper/VAD/ASR — it only exposes the raw
 * (resampled-later) audio graph. Processing hooks in via `onAudioReady`.
 */

import type { ChromeTabCaptureConstraints } from "./chrome-media-constraints";

export type CaptureHandle = {
  stream: MediaStream;
  stop: () => void;
};

let sharedAudioContext: AudioContext | null = null;

const getSharedAudioContext = (): AudioContext => {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
};

export type StartCaptureResult = {
  /** Disconnects the graph and stops the underlying tracks. Idempotent. */
  stop: () => void;
  /** The AudioContext this capture's nodes were built on, for wiring further processing. */
  audioContext: AudioContext;
  /** Source node for the raw captured tab audio; connect processing nodes to this. */
  sourceNode: MediaStreamAudioSourceNode;
};

/**
 * Starts tab capture from a `chrome.tabCapture.getMediaStreamId()` stream id and
 * restores playback to the user's speakers, per Chrome's documented pattern:
 * https://developer.chrome.com/docs/extensions/reference/api/tabCapture
 * ("When a MediaStream is obtained for a tab, audio in that tab will no longer be
 * played to the user" — the fix is an explicit MediaStreamAudioSourceNode -> destination
 * connection here, in the offscreen document that owns the getUserMedia call).
 */
export const startTabCapture = async (streamId: string, onEnded: () => void): Promise<StartCaptureResult> => {
  const constraints: ChromeTabCaptureConstraints = {
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  const audioContext = getSharedAudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const sourceNode = audioContext.createMediaStreamSource(stream);
  // Restore playback: without this, the captured tab goes silent to the user
  // (Chrome mutes a tab's normal output once its stream is captured).
  sourceNode.connect(audioContext.destination);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    sourceNode.disconnect();
    for (const track of stream.getTracks()) track.stop();
  };

  // "ended" fires only when the source goes away on its own (the tab closed, Chrome revoked
  // the capture), never for our own track.stop(). Without it, a dead stream keeps the source
  // node producing silence and capture looks alive with a level of zero.
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => {
      if (stopped) return;
      stop();
      onEnded();
    });
  }

  return { stop, audioContext, sourceNode };
};

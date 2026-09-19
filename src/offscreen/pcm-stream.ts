/**
 * Taps a MediaStream as 16 kHz mono float32 PCM batches for the ASR worker. Uses its
 * own AudioContext created at 16 kHz so Chrome does the resampling natively (no
 * chunk-boundary drift, unlike resampling batch by batch in JS); the playback context
 * in capture.ts is separate and untouched.
 */
import pcmWorkletUrl from "./pcm-worklet.ts?worker&url";

export type PcmStream = {
  /** Disconnects the graph and closes the context. Idempotent. */
  stop: () => void;
};

export const startPcmStream = async (
  stream: MediaStream,
  onBatch: (samples: Float32Array) => void,
): Promise<PcmStream> => {
  const context = new AudioContext({ sampleRate: 16_000 });
  await context.audioWorklet.addModule(pcmWorkletUrl);
  if (context.state === "suspended") await context.resume();

  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, "pcm-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
  worklet.port.onmessage = (message: MessageEvent<Float32Array>) => onBatch(message.data);

  // The worklet has no audible output, but Chrome only pulls nodes that reach the
  // destination; a zero-gain stage keeps it running silently.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(worklet).connect(mute).connect(context.destination);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    worklet.port.onmessage = null;
    source.disconnect();
    worklet.disconnect();
    void context.close();
  };
  return { stop };
};

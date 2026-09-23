/**
 * Taps the captured tab audio as 16 kHz mono float32 PCM batches for the ASR worker.
 *
 * Runs on the *same* AudioContext that plays the audio back, rather than its own 16 kHz
 * context. A tabCapture MediaStream only feeds one consumer: with a second
 * AudioContext + MediaStreamAudioSourceNode over the same stream, the tap received a
 * steady stream of batches containing nothing but zeros (260 chunks at level 0.000) while
 * playback kept working. Sharing the context means one source node and one consumer, at the
 * cost of resampling here instead of letting Chrome do it.
 */
import { resampleTo16kHz } from "../worker/resample";
import pcmWorkletUrl from "./pcm-worklet.ts?worker&url";

const WORKLET_NAME = "pcm-capture";
/** Batch length in seconds; the worklet's batch size is derived from the context's rate. */
const BATCH_SECONDS = 0.1;

/** addModule() re-executes the script, and registerProcessor() throws on a duplicate name. */
const contextsWithModule = new WeakSet<BaseAudioContext>();

export type PcmStream = {
  /** Disconnects the tap. Idempotent. Leaves the shared context and playback untouched. */
  stop: () => void;
};

export const startPcmStream = async (
  context: AudioContext,
  source: AudioNode,
  onBatch: (samples: Float32Array) => void,
): Promise<PcmStream> => {
  if (!contextsWithModule.has(context)) {
    await context.audioWorklet.addModule(pcmWorkletUrl);
    contextsWithModule.add(context);
  }

  const worklet = new AudioWorkletNode(context, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { batchSize: Math.round(context.sampleRate * BATCH_SECONDS) },
  });
  worklet.port.onmessage = (message: MessageEvent<Float32Array>) =>
    onBatch(resampleTo16kHz(message.data, context.sampleRate));

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
    // Only the tap's own nodes: `source` is also wired to the speakers by capture.ts.
    try {
      source.disconnect(worklet);
    } catch {
      // Already torn down with the source node itself.
    }
    worklet.disconnect();
    mute.disconnect();
  };
  return { stop };
};

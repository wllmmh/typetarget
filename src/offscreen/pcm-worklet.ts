/**
 * AudioWorklet processor: mono-downmixes the tab audio it is fed and posts fixed-size
 * batches to the main thread, at the context's own sample rate (pcm-stream.ts resamples
 * to the 16 kHz Whisper needs). Runs in AudioWorkletGlobalScope; bundled as its own script
 * by Vite (see pcm-stream.ts's `?worker&url` import).
 */
import { PcmBatcher } from "./pcm-batcher";

// AudioWorkletGlobalScope globals; TypeScript's DOM lib doesn't declare them.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
type AudioWorkletNodeOptionsLike = { processorOptions?: { batchSize?: number } };
declare const registerProcessor: (
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptionsLike) => AudioWorkletProcessor,
) => void;

/** Fallback if the node is constructed without processorOptions (~100 ms at 48 kHz). */
const DEFAULT_BATCH_SAMPLES = 4800;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly batcher: PcmBatcher;

  constructor(options?: AudioWorkletNodeOptionsLike) {
    super();
    this.batcher = new PcmBatcher(options?.processorOptions?.batchSize ?? DEFAULT_BATCH_SAMPLES, (samples) =>
      this.port.postMessage(samples, [samples.buffer]),
    );
  }

  process(inputs: Float32Array[][]): boolean {
    const [input] = inputs;
    if (input && input.length > 0) this.batcher.push(input);
    return true; // keep the processor alive for the life of the node
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

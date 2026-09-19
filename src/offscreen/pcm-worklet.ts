/**
 * AudioWorklet processor: mono-downmixes the tab audio it is fed and posts 100 ms
 * batches of PCM to the main thread. Runs in AudioWorkletGlobalScope; bundled as its
 * own script by Vite (see pcm-stream.ts's `?worker&url` import).
 */
import { PcmBatcher } from "./pcm-batcher";

// AudioWorkletGlobalScope globals; TypeScript's DOM lib doesn't declare them.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const registerProcessor: (name: string, processorCtor: new () => AudioWorkletProcessor) => void;

/** 100 ms at the 16 kHz the AudioContext is created with. */
const BATCH_SAMPLES = 1600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly batcher = new PcmBatcher(BATCH_SAMPLES, (samples) => this.port.postMessage(samples, [samples.buffer]));

  process(inputs: Float32Array[][]): boolean {
    const [input] = inputs;
    if (input && input.length > 0) this.batcher.push(input);
    return true; // keep the processor alive for the life of the node
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

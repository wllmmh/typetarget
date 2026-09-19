/**
 * Downmixes multi-channel Web Audio render quanta (128 frames each) to mono and
 * regroups them into fixed-size batches, so the ASR worker gets a few large messages
 * instead of one per quantum. Pure and DOM-free so it can run inside the AudioWorklet
 * and be unit-tested directly.
 */
export class PcmBatcher {
  private batch: Float32Array;
  private filled = 0;

  constructor(
    private readonly batchSize: number,
    private readonly onBatch: (samples: Float32Array) => void,
  ) {
    this.batch = new Float32Array(batchSize);
  }

  /** `channels` is one render quantum: one Float32Array per channel, all the same length. */
  push(channels: Float32Array[]): void {
    const [first] = channels;
    if (!first) return;

    for (let i = 0; i < first.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] ?? 0;
      this.batch[this.filled++] = sum / channels.length;

      if (this.filled === this.batchSize) {
        // Hand off the filled buffer (it may be transferred) and start a fresh one.
        const full = this.batch;
        this.batch = new Float32Array(this.batchSize);
        this.filled = 0;
        this.onBatch(full);
      }
    }
  }
}

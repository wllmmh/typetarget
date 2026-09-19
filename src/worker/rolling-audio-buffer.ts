/**
 * Append-only buffer of 16 kHz mono float32 PCM that can be trimmed from the front.
 * Chunks are stored as-is (no per-append copy); they are only concatenated when a
 * snapshot is requested for inference.
 */
export class RollingAudioBuffer {
  private chunks: Float32Array[] = [];
  private lengthSamples = 0;

  get length(): number {
    return this.lengthSamples;
  }

  append(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.chunks.push(samples);
    this.lengthSamples += samples.length;
  }

  /**
   * Drops whole chunks from the front while at least `maxSamples` remain afterwards.
   * Chunk-granular on purpose (no copying), so up to one chunk more than `maxSamples`
   * may be retained.
   */
  trimToRecent(maxSamples: number): void {
    while (this.chunks.length > 0 && this.lengthSamples - (this.chunks[0]?.length ?? 0) >= maxSamples) {
      const dropped = this.chunks.shift();
      this.lengthSamples -= dropped?.length ?? 0;
    }
  }

  /** Copies everything currently buffered into one contiguous array. */
  snapshot(): Float32Array {
    const out = new Float32Array(this.lengthSamples);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  clear(): void {
    this.chunks = [];
    this.lengthSamples = 0;
  }
}

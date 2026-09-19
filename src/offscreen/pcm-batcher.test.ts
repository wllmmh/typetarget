import { describe, expect, it, vi } from "vitest";
import { PcmBatcher } from "./pcm-batcher";

const quantum = (value: number, length = 128) => new Float32Array(length).fill(value);

describe("PcmBatcher", () => {
  it("emits fixed-size batches once enough frames have arrived", () => {
    const onBatch = vi.fn();
    const batcher = new PcmBatcher(256, onBatch);

    batcher.push([quantum(0.5)]);
    expect(onBatch).not.toHaveBeenCalled();

    batcher.push([quantum(0.5)]);
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch.mock.calls[0]?.[0]).toHaveLength(256);
  });

  it("downmixes channels to mono by averaging", () => {
    const onBatch = vi.fn();
    const batcher = new PcmBatcher(4, onBatch);

    batcher.push([new Float32Array([1, 0, 0.5, -1]), new Float32Array([0, 1, 0.5, 1])]);

    expect(Array.from(onBatch.mock.calls[0]?.[0] as Float32Array)).toEqual([0.5, 0.5, 0.5, 0]);
  });

  it("carries a partial batch across pushes and splits an oversized push into several batches", () => {
    const onBatch = vi.fn();
    const batcher = new PcmBatcher(100, onBatch);

    batcher.push([quantum(1, 60)]);
    batcher.push([quantum(2, 150)]); // completes batch 1 (60 + 40), batch 2 (100), leaves 10

    expect(onBatch).toHaveBeenCalledTimes(2);
    const first = onBatch.mock.calls[0]?.[0] as Float32Array;
    expect(first[59]).toBe(1);
    expect(first[60]).toBe(2);
  });

  it("gives each batch its own buffer, so a transferred batch can't be overwritten", () => {
    const batches: Float32Array[] = [];
    const batcher = new PcmBatcher(4, (samples) => batches.push(samples));

    batcher.push([new Float32Array([1, 1, 1, 1])]);
    batcher.push([new Float32Array([2, 2, 2, 2])]);

    expect(Array.from(batches[0] ?? [])).toEqual([1, 1, 1, 1]);
    expect(Array.from(batches[1] ?? [])).toEqual([2, 2, 2, 2]);
  });

  it("ignores an empty channel list", () => {
    const onBatch = vi.fn();
    new PcmBatcher(4, onBatch).push([]);
    expect(onBatch).not.toHaveBeenCalled();
  });
});

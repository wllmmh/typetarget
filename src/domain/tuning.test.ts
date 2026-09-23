import { describe, expect, it } from "vitest";
import { CHUNK_MS_DEFAULT, CHUNK_MS_MAX, CHUNK_MS_MIN, clampChunkMs } from "./tuning";

describe("clampChunkMs", () => {
  it("keeps a value inside the supported range", () => {
    expect(clampChunkMs(8_000)).toBe(8_000);
  });

  it("clamps to the bounds rather than rejecting", () => {
    expect(clampChunkMs(500)).toBe(CHUNK_MS_MIN);
    expect(clampChunkMs(120_000)).toBe(CHUNK_MS_MAX);
  });

  it("falls back to the default for junk, since this crosses a message boundary", () => {
    expect(clampChunkMs(Number.NaN)).toBe(CHUNK_MS_DEFAULT);
    expect(clampChunkMs(Number.POSITIVE_INFINITY)).toBe(CHUNK_MS_DEFAULT);
  });

  it("rounds to whole milliseconds", () => {
    expect(clampChunkMs(7_500.6)).toBe(7_501);
  });
});

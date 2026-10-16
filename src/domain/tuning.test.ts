import { describe, expect, it } from "vitest";
import { clampUtteranceCapMs, stretchedUtteranceCapMs, UTTERANCE_CAP_MAX_MS, UTTERANCE_CAP_MS } from "./tuning";

describe("clampUtteranceCapMs", () => {
  it("keeps a value inside the supported range", () => {
    expect(clampUtteranceCapMs(8_000)).toBe(8_000);
  });

  it("clamps to the bounds rather than rejecting", () => {
    expect(clampUtteranceCapMs(500)).toBe(UTTERANCE_CAP_MS);
    expect(clampUtteranceCapMs(120_000)).toBe(UTTERANCE_CAP_MAX_MS);
  });

  it("falls back to the default for junk, since this crosses a message boundary", () => {
    expect(clampUtteranceCapMs(Number.NaN)).toBe(UTTERANCE_CAP_MS);
    expect(clampUtteranceCapMs(Number.POSITIVE_INFINITY)).toBe(UTTERANCE_CAP_MS);
  });

  it("rounds to whole milliseconds", () => {
    expect(clampUtteranceCapMs(7_500.6)).toBe(7_501);
  });
});

describe("stretchedUtteranceCapMs", () => {
  it("keeps the base cap while inference is faster than it", () => {
    expect(stretchedUtteranceCapMs(UTTERANCE_CAP_MS, 500)).toBe(UTTERANCE_CAP_MS);
  });

  it("stretches past a slow inference, with headroom, so the next call keeps up", () => {
    expect(stretchedUtteranceCapMs(UTTERANCE_CAP_MS, 8_000)).toBe(10_000);
  });

  it("never goes below the chunk length the user chose", () => {
    expect(stretchedUtteranceCapMs(12_000, 8_000)).toBe(12_000);
  });

  it("never passes the maximum", () => {
    expect(stretchedUtteranceCapMs(UTTERANCE_CAP_MS, 60_000)).toBe(UTTERANCE_CAP_MAX_MS);
  });
});

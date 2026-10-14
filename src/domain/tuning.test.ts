import { describe, expect, it } from "vitest";
import { stretchedUtteranceCapMs, UTTERANCE_CAP_MAX_MS, UTTERANCE_CAP_MS } from "./tuning";

describe("stretchedUtteranceCapMs", () => {
  it("keeps the base cap while inference is faster than it", () => {
    expect(stretchedUtteranceCapMs(500)).toBe(UTTERANCE_CAP_MS);
  });

  it("stretches past a slow inference, with headroom, so the next call keeps up", () => {
    expect(stretchedUtteranceCapMs(8_000)).toBe(10_000);
  });

  it("never passes the maximum", () => {
    expect(stretchedUtteranceCapMs(60_000)).toBe(UTTERANCE_CAP_MAX_MS);
  });
});

import { describe, expect, it } from "vitest";
import { resampleTo16kHz } from "./resample";

describe("resampleTo16kHz", () => {
  it("returns the input unchanged when already at 16kHz", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleTo16kHz(input, 16_000)).toBe(input);
  });

  it("downsamples 48kHz to 16kHz at a 3:1 ratio", () => {
    const input = new Float32Array(48_000); // 1 second at 48kHz
    const output = resampleTo16kHz(input, 48_000);
    expect(output.length).toBe(16_000);
  });

  it("upsamples 8kHz to 16kHz at a 1:2 ratio", () => {
    const input = new Float32Array(8_000); // 1 second at 8kHz
    const output = resampleTo16kHz(input, 8_000);
    expect(output.length).toBe(16_000);
  });

  it("preserves a constant signal's amplitude", () => {
    const input = new Float32Array(48_000).fill(0.5);
    const output = resampleTo16kHz(input, 48_000);
    expect(output.every((sample) => Math.abs(sample - 0.5) < 1e-6)).toBe(true);
  });

  it("does not throw on very short input", () => {
    expect(() => resampleTo16kHz(new Float32Array([0.1]), 48_000)).not.toThrow();
  });
});

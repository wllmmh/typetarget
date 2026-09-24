import { describe, expect, it } from "vitest";
import { float32ToPcm16Base64 } from "./pcm16-encode";

/** Decodes back to the int16 values actually encoded, so tests assert on numbers
 * rather than hand-computed base64 strings. */
const decode = (base64: string): number[] => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) out.push(view.getInt16(i, true));
  return out;
};

describe("float32ToPcm16Base64", () => {
  it("round-trips silence to zero", () => {
    expect(decode(float32ToPcm16Base64(new Float32Array([0, 0, 0])))).toEqual([0, 0, 0]);
  });

  it("maps full-scale positive and negative samples to int16 extremes", () => {
    expect(decode(float32ToPcm16Base64(new Float32Array([1, -1])))).toEqual([32767, -32768]);
  });

  it("clamps out-of-range input rather than wrapping", () => {
    expect(decode(float32ToPcm16Base64(new Float32Array([2.5, -3.0])))).toEqual([32767, -32768]);
  });

  it("produces two bytes of output per input sample", () => {
    const base64 = float32ToPcm16Base64(new Float32Array(1600));
    expect(atob(base64).length).toBe(3200);
  });

  it("returns an empty string for empty input", () => {
    expect(float32ToPcm16Base64(new Float32Array(0))).toBe("");
  });
});

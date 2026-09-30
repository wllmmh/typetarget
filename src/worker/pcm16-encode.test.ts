import { describe, expect, it } from "vitest";
import { float32ToPcm16Base64, float32ToWav } from "./pcm16-encode";

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

describe("float32ToWav", () => {
  it("writes a mono 16-bit PCM RIFF header followed by the samples", () => {
    const wav = float32ToWav(new Float32Array([1, -1, 0]), 16_000);
    const view = new DataView(wav.buffer);
    const ascii = (offset: number) => String.fromCharCode(...wav.slice(offset, offset + 4));

    expect(wav.length).toBe(44 + 3 * 2);
    expect(ascii(0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 6);
    expect(ascii(8)).toBe("WAVE");
    expect(ascii(12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([32767, -32768, 0]);
  });
});

/**
 * Converts float32 PCM samples (as already produced by src/worker/resample.ts — mono,
 * 16 kHz, [-1, 1] normalized) to 16-bit signed PCM, little-endian: base64-encoded raw for
 * Gemini's Live API (LiveClientRealtimeInput.audio = { data, mimeType:
 * "audio/pcm;rate=16000" } — see HANDOFF.md "Gemini Live"), or wrapped in a WAV header for
 * Groq's file-upload endpoint. No new dependency: this is the "~20 lines of local code"
 * case, same reasoning as resample.ts.
 */
const float32ToPcm16Bytes = (samples: Float32Array, byteOffset = 0): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(byteOffset + samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    view.setInt16(byteOffset + i * 2, int16, true);
  }
  return bytes;
};

export const float32ToPcm16Base64 = (samples: Float32Array): string => {
  let binary = "";
  for (const byte of float32ToPcm16Bytes(samples)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const WAV_HEADER_BYTES = 44;

/** A complete mono 16-bit PCM WAV file (canonical 44-byte RIFF header). */
export const float32ToWav = (samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> => {
  const bytes = float32ToPcm16Bytes(samples, WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  const dataBytes = samples.length * 2;
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
};

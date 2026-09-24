/**
 * Converts float32 PCM samples (as already produced by src/worker/resample.ts — mono,
 * 16 kHz, [-1, 1] normalized) to what Gemini's Live API expects for realtime audio
 * input: raw 16-bit signed PCM, little-endian, base64-encoded
 * (LiveClientRealtimeInput.audio = { data, mimeType: "audio/pcm;rate=16000" } — see
 * HANDOFF.md "Gemini Live"). No new dependency: this is the "~20 lines of local code"
 * case, same reasoning as resample.ts.
 */
export const float32ToPcm16Base64 = (samples: Float32Array): string => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    view.setInt16(i * 2, int16, true);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/**
 * Resamples mono float32 PCM to Whisper's required 16 kHz (AGENTS.md "Audio
 * pipeline": "mono, 16 kHz, PCM float32"). Tab-captured audio typically arrives at
 * the AudioContext's native rate (usually 44.1/48 kHz), so this always runs.
 *
 * Linear interpolation, not a proper polyphase/sinc resampler: adequate for speech
 * recognition (Whisper's own training data includes plenty of resampled/compressed
 * audio) and avoids pulling in a DSP dependency for V1. AGENTS.md's "no new
 * dependency if ~20 lines of local code covers it" — this is that.
 */
export const resampleTo16kHz = (input: Float32Array, inputSampleRate: number): Float32Array => {
  const targetRate = 16_000;
  if (inputSampleRate === targetRate) return input;

  const ratio = inputSampleRate / targetRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIndexLow = Math.floor(srcPos);
    const srcIndexHigh = Math.min(srcIndexLow + 1, input.length - 1);
    const frac = srcPos - srcIndexLow;
    const lowSample = input[srcIndexLow] ?? 0;
    const highSample = input[srcIndexHigh] ?? 0;
    output[i] = lowSample + (highSample - lowSample) * frac;
  }

  return output;
};

/** Downmixes a multi-channel interleaved-or-planar buffer set to mono by averaging channels. */
export const downmixToMono = (channels: Float32Array[]): Float32Array => {
  if (channels.length === 0) return new Float32Array(0);
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;

  const length = first.length;
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    output[i] = sum / channels.length;
  }
  return output;
};

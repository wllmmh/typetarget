/**
 * Resamples mono float32 PCM to the 16 kHz every engine expects. Tab-captured audio
 * arrives at the AudioContext's native rate (usually 44.1/48 kHz), so this always runs.
 *
 * Linear interpolation, not a polyphase/sinc resampler: adequate for speech recognition,
 * and ~20 lines instead of a DSP dependency.
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

/**
 * Simple energy-based VAD behind the VoiceActivityDetector interface (domain/vad.ts), so a
 * model-based VAD can replace it. Knows nothing beyond "a frame of samples in, an event
 * out."
 *
 * Algorithm: track RMS energy per frame; declare speech-start once energy has stayed
 * above threshold for `speechHoldMs`, and speech-end once energy has stayed below
 * threshold for `silenceHoldMs`. The hold windows exist so brief dips (a consonant,
 * a breath) inside a sentence don't fragment it into many short utterances.
 */
import type { VadEvent, VadState, VoiceActivityDetector } from "../domain/vad";

export type EnergyVadOptions = {
  /** RMS amplitude (0..1) above which a frame counts as "loud enough to be speech". */
  energyThreshold: number;
  /** How long energy must stay above threshold before declaring speech-start. */
  speechHoldMs: number;
  /** How long energy must stay below threshold before declaring speech-end. */
  silenceHoldMs: number;
};

export const DEFAULT_ENERGY_VAD_OPTIONS: EnergyVadOptions = {
  energyThreshold: 0.02,
  speechHoldMs: 150,
  silenceHoldMs: 500,
};

const computeRms = (frame: Float32Array): number => {
  let sumSquares = 0;
  for (const sample of frame) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / frame.length);
};

export class EnergyVad implements VoiceActivityDetector {
  private state: VadState = "silence";
  private aboveThresholdSinceMs: number | null = null;
  private belowThresholdSinceMs: number | null = null;

  constructor(private readonly options: EnergyVadOptions = DEFAULT_ENERGY_VAD_OPTIONS) {}

  processFrame(frame: Float32Array, timestamp: number): VadEvent | null {
    const isLoud = computeRms(frame) >= this.options.energyThreshold;

    if (isLoud) {
      this.belowThresholdSinceMs = null;
      this.aboveThresholdSinceMs ??= timestamp;

      if (this.state === "silence" && timestamp - this.aboveThresholdSinceMs >= this.options.speechHoldMs) {
        this.state = "speech";
        return { type: "speech-start", timestamp };
      }
      return null;
    }

    this.aboveThresholdSinceMs = null;
    this.belowThresholdSinceMs ??= timestamp;

    if (this.state === "speech" && timestamp - this.belowThresholdSinceMs >= this.options.silenceHoldMs) {
      this.state = "silence";
      return { type: "speech-end", timestamp };
    }
    return null;
  }

  getState(): VadState {
    return this.state;
  }

  reset(): void {
    this.state = "silence";
    this.aboveThresholdSinceMs = null;
    this.belowThresholdSinceMs = null;
  }
}

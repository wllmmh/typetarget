/**
 * Voice activity detection contract, independent of both the audio pipeline and the ASR
 * engine, so a model-based VAD (e.g. Silero) can replace the energy VAD without touching
 * either.
 */
export type VadState = "silence" | "speech";

export type VadEvent =
  | { type: "speech-start"; timestamp: number }
  | { type: "speech-end"; timestamp: number };

export interface VoiceActivityDetector {
  /** Feeds one frame of mono PCM float32 audio (at the detector's expected sample rate). */
  processFrame(frame: Float32Array, timestamp: number): VadEvent | null;
  getState(): VadState;
  reset(): void;
}

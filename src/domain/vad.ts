/**
 * Voice activity detection contract. Deliberately decoupled from both the audio
 * pipeline and the ASR engine (AGENTS.md "Voice activity detection": "Do not make
 * VAD tightly coupled to the Whisper implementation" / "must be replaceable") so a
 * future Silero VAD (or any other model) can implement this same interface without
 * touching the audio worklet or the transcription worker.
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

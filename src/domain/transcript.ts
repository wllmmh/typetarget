import type { EngineStatus } from "./models";

export type TranscriptionStatus =
  | "idle"
  | "loading-model"
  | "capturing"
  | "transcribing"
  | "paused"
  | "error";

/** Transcript generation (`src/worker`, `src/offscreen`) and DOM insertion (`src/content`)
 * only communicate through these events. */
export type TranscriptEvent =
  | { type: "partial"; text: string; timestamp: number }
  | { type: "final"; text: string; timestamp: number }
  | { type: "status"; status: TranscriptionStatus }
  | { type: "error"; code: string; message: string };

export type { EngineStatus };

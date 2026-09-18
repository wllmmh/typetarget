import type { EngineStatus } from "./models";

export type TranscriptionStatus =
  | "idle"
  | "loading-model"
  | "capturing"
  | "transcribing"
  | "paused"
  | "error";

/** Internal event model per AGENTS.md "Transcript event model". Transcript generation
 * (this file's producers, in `src/worker` and `src/offscreen`) stays independent of
 * DOM insertion (`src/content`) — they only communicate through these events. */
export type TranscriptEvent =
  | { type: "partial"; text: string; timestamp: number }
  | { type: "final"; text: string; timestamp: number }
  | { type: "status"; status: TranscriptionStatus }
  | { type: "error"; code: string; message: string };

export type { EngineStatus };

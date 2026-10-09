/**
 * Turns a sequence of overlapping hypotheses for one utterance (each a provider's best
 * guess so far) into partial/final TranscriptEvents without duplicating text downstream:
 *
 *   partial "The quarterly"
 *   partial "The quarterly revenue"
 *   final   "The quarterly revenue numbers"
 *   -> destination receives "The quarterly revenue numbers", not the concatenation.
 *
 * Knows nothing about audio, VAD or any engine: strings in, events out.
 */
import type { TranscriptEvent } from "../domain/transcript";

export class TranscriptStabilizer {
  private lastPartial = "";

  /**
   * Feeds a new hypothesis for the open utterance. Returns it as a "partial" event (the whole
   * hypothesis, which replaces the previous partial), or null if it is empty or unchanged.
   */
  onHypothesis(text: string, timestamp: number): TranscriptEvent | null {
    const trimmed = text.trim();
    if (trimmed === this.lastPartial) return null;

    this.lastPartial = trimmed;
    if (trimmed === "") return null;
    return { type: "partial", text: trimmed, timestamp };
  }

  /**
   * Call when the current utterance is complete. Emits one "final" event, which replaces
   * (is never appended to) the utterance's partials, and resets partial tracking.
   */
  onFinal(text: string, timestamp: number): TranscriptEvent | null {
    const trimmed = text.trim();
    this.lastPartial = "";
    if (trimmed === "") return null;
    return { type: "final", text: trimmed, timestamp };
  }

  reset(): void {
    this.lastPartial = "";
  }
}

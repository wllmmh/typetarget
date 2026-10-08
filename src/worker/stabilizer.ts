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

/**
 * Finds the length of the longest common prefix between two strings, used to detect
 * whether `next` is simply an extension of `previous` (the common "growing
 * hypothesis" case) versus a genuinely different re-interpretation of the same audio.
 */
const commonPrefixLength = (a: string, b: string): number => {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
};

export type StabilizerOptions = {
  /**
   * Minimum fraction of the shorter string that must match as a common prefix for
   * two hypotheses to be treated as "the same utterance, refined" rather than "a
   * new, unrelated guess" (which resets partial tracking instead of diffing).
   */
  minPrefixOverlapRatio: number;
};

export const DEFAULT_STABILIZER_OPTIONS: StabilizerOptions = {
  minPrefixOverlapRatio: 0.6,
};

export class TranscriptStabilizer {
  private lastPartial = "";

  /**
   * Feeds a new rolling-window hypothesis. Returns a "partial" event with only the
   * text that's new/changed relative to what was already emitted, or null if the
   * hypothesis is unchanged (avoids re-sending/re-inserting identical text).
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

/**
 * The text `next` adds to `previous`, or all of `next` when it is a different guess rather
 * than a refinement. The stabilizer itself always emits the full hypothesis.
 */
export const hypothesisDelta = (previous: string, next: string, options: StabilizerOptions = DEFAULT_STABILIZER_OPTIONS): string => {
  const prefixLen = commonPrefixLength(previous, next);
  const shorterLen = Math.min(previous.length, next.length);
  const isRefinement = shorterLen === 0 || prefixLen / shorterLen >= options.minPrefixOverlapRatio;
  return isRefinement ? next.slice(prefixLen) : next;
};

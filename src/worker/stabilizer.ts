/**
 * Turns a sequence of overlapping partial-hypothesis strings (each one Whisper's
 * best guess for the current rolling audio window, which grows/changes as more
 * audio arrives) into partial/final TranscriptEvents without ever emitting
 * duplicated text downstream. Per AGENTS.md "Streaming transcription":
 *
 *   partial "The quarterly"
 *   partial "The quarterly revenue"
 *   partial "The quarterly revenue numbers"
 *   -> destination receives "The quarterly revenue numbers", not the concatenation
 *      of all three.
 *
 * This module is intentionally ignorant of audio/VAD/Whisper — it only knows about
 * strings coming in and TranscriptEvents going out (AGENTS.md "Keep transcript
 * generation independent from DOM insertion").
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
   * Call when VAD/the caller decides the current utterance is complete. Emits a
   * single "final" event for the stabilized text (deduplicated against whatever was
   * last reported as partial, per the rule above) and resets partial tracking for
   * the next utterance.
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
 * Utility for callers that want to know just the "delta" text between two
 * consecutive hypotheses (e.g. to log/debug what actually changed). Not used by the
 * stabilizer's own dedup logic above (which always emits the full current
 * hypothesis, matching how a UI's "live partial preview" should just replace its
 * displayed text) — provided because a common failure mode this module exists to
 * prevent is naively concatenating consecutive partials instead of replacing.
 */
export const hypothesisDelta = (previous: string, next: string, options: StabilizerOptions = DEFAULT_STABILIZER_OPTIONS): string => {
  const prefixLen = commonPrefixLength(previous, next);
  const shorterLen = Math.min(previous.length, next.length);
  const isRefinement = shorterLen === 0 || prefixLen / shorterLen >= options.minPrefixOverlapRatio;
  return isRefinement ? next.slice(prefixLen) : next;
};

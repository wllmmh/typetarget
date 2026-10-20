/**
 * How long one utterance may grow before it is transcribed anyway, when speech runs on without a
 * pause (a pause ends it sooner). The popup's "Chunk length" slider sets it, and these bounds are
 * shared so the slider and the service worker's validation cannot drift apart. Short keeps
 * transcription live, and the hosted models are fast enough to keep up with it. Long gives the
 * model more speech to go on, which helps it detect the spoken language. See
 * docs/adr/0018-chunk-length-slider-returns.md and docs/adr/0022-chunk-length-from-1-to-30-seconds.md.
 */
export const UTTERANCE_CAP_MS = 3_000; // the default

export const UTTERANCE_CAP_MIN_MS = 1_000;

/** Whisper's window. The pre-roll before an utterance counts toward the cap, so the audio fits
 * it, give or take the last batch (~100 ms) that took the utterance past the cap. */
export const UTTERANCE_CAP_MAX_MS = 30_000;

export const UTTERANCE_CAP_STEP_MS = 500;

/** Messages are a boundary: a value from the popup is clamped, and junk falls back to the default. */
export const clampUtteranceCapMs = (ms: number): number => {
  if (!Number.isFinite(ms)) return UTTERANCE_CAP_MS;
  return Math.min(UTTERANCE_CAP_MAX_MS, Math.max(UTTERANCE_CAP_MIN_MS, Math.round(ms)));
};

/** How much longer than one inference the cap is stretched to, so the next call has room to spare. */
const KEEP_UP_HEADROOM = 1.25;

/**
 * Local Whisper's cap after an inference that took `inferenceMs`, given the user's `baseCapMs`.
 * Each call costs about the same whatever the audio's length (Whisper pads to a 30 s window), so a
 * machine slower than the base cap only keeps up with a longer one: the cap stretches to the call's
 * time plus headroom, and comes back down as calls get faster. Never below the base cap, never
 * past the maximum.
 */
export const stretchedUtteranceCapMs = (baseCapMs: number, inferenceMs: number): number =>
  Math.min(UTTERANCE_CAP_MAX_MS, Math.max(baseCapMs, Math.ceil(inferenceMs * KEEP_UP_HEADROOM)));

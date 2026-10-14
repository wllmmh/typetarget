/**
 * How long one utterance may grow before it is transcribed anyway, when speech runs on without a
 * pause (a pause ends it sooner). Short keeps transcription live, and the hosted models are fast
 * enough to keep up with it. See docs/adr/0017-utterance-cap-set-by-typetarget.md.
 */
export const UTTERANCE_CAP_MS = 3_000;

/** Kept under Whisper's 30 s window, with room for the pre-roll that precedes an utterance. */
export const UTTERANCE_CAP_MAX_MS = 25_000;

/** How much longer than one inference the cap is stretched to, so the next call has room to spare. */
const KEEP_UP_HEADROOM = 1.25;

/**
 * Local Whisper's cap after an inference that took `inferenceMs`. Each call costs about the same
 * whatever the audio's length (Whisper pads to a 30 s window), so a machine slower than the base
 * cap only keeps up with a longer one: the cap stretches to the call's time plus headroom, and
 * comes back down as calls get faster. Never below the base cap, never past the maximum.
 */
export const stretchedUtteranceCapMs = (inferenceMs: number): number =>
  Math.min(UTTERANCE_CAP_MAX_MS, Math.max(UTTERANCE_CAP_MS, Math.ceil(inferenceMs * KEEP_UP_HEADROOM)));

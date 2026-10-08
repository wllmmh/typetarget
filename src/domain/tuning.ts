/**
 * User-tunable pipeline settings, shared so the popup's control and the service worker's
 * validation cannot drift apart.
 *
 * Chunk length caps how long one utterance grows before it is transcribed anyway. It is the
 * main latency/throughput trade-off: inference cost is roughly fixed per call (Whisper pads
 * to a 30 s window), so short chunks get text sooner but do far more work per second of
 * audio, while long chunks keep up better and lag further behind.
 */

/** Short enough to be worth trying, long enough that one inference isn't pure overhead. */
export const CHUNK_MS_MIN = 3_000;
/** Kept under Whisper's 30 s window, with room for the pre-roll that precedes an utterance. */
export const CHUNK_MS_MAX = 25_000;
export const CHUNK_MS_DEFAULT = 3_000;
export const CHUNK_MS_STEP = 1_000;

/** Messages are a boundary: a value from the popup is clamped, and junk falls back to the default. */
export const clampChunkMs = (ms: number): number => {
  if (!Number.isFinite(ms)) return CHUNK_MS_DEFAULT;
  return Math.min(CHUNK_MS_MAX, Math.max(CHUNK_MS_MIN, Math.round(ms)));
};

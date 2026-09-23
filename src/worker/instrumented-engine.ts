/**
 * Wraps a TranscriptionEngine to count inference calls and their durations.
 *
 * Exists because "audio is arriving but no transcript appears" is otherwise
 * indistinguishable from "inference is running and each call takes longer than the audio it
 * covers". The counters are surfaced in the popup's diagnostics.
 */
import type { EngineStatus, ModelId, TranscriptionEngine, TranscriptionOptions, TranscriptionResult } from "../domain/models";

export type InferenceStats = {
  started: number;
  finished: number;
  failed: number;
  /** Duration of the most recently completed call, in ms. */
  lastMs: number | null;
};

export const createInstrumentedEngine = (
  engine: TranscriptionEngine,
  onStats: (stats: InferenceStats) => void,
  now: () => number = () => Date.now(),
): TranscriptionEngine => {
  const stats: InferenceStats = { started: 0, finished: 0, failed: 0, lastMs: null };
  const report = () => onStats({ ...stats });

  return {
    load: (model: ModelId) => engine.load(model),
    unload: () => engine.unload(),
    reset: () => engine.reset(),
    getStatus: (): EngineStatus => engine.getStatus(),
    transcribe: async (audio: Float32Array, options?: TranscriptionOptions): Promise<TranscriptionResult> => {
      const startedAt = now();
      stats.started++;
      report();
      try {
        const result = await engine.transcribe(audio, options);
        stats.finished++;
        stats.lastMs = now() - startedAt;
        return result;
      } catch (err) {
        stats.failed++;
        stats.lastMs = now() - startedAt;
        throw err;
      } finally {
        report();
      }
    },
  };
};

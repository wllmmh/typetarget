/**
 * Streaming pipeline core: feeds 16 kHz mono PCM through VAD, runs rolling-window
 * inference on the current utterance for live partials, and runs one inference over
 * the whole utterance when VAD says it ended, for the final. Knows nothing about
 * Web Audio, workers, or whisper.cpp — only the TranscriptionEngine, VoiceActivityDetector
 * and TranscriptStabilizer contracts — so it is testable with plain synthetic audio.
 *
 * Time is audio time (derived from samples received), not wall-clock, so behavior is
 * deterministic and independent of how fast chunks are delivered.
 *
 * Inference is serialized (the engine has one context and one output channel):
 * at most one partial is ever in flight and a new one is skipped rather than queued
 * (falling behind must not build a backlog), while a final always runs, after any
 * in-flight work. A partial that completes after its utterance was finalized is dropped.
 */
import type { TranscriptEvent } from "../domain/transcript";
import type { TranscriptionEngine } from "../domain/models";
import { CHUNK_MS_DEFAULT } from "../domain/tuning";
import type { VoiceActivityDetector } from "../domain/vad";
import { RollingAudioBuffer } from "./rolling-audio-buffer";
import type { TranscriptStabilizer } from "./stabilizer";

export const SAMPLE_RATE = 16_000;

export type StreamingOptions = {
  /** Audio kept from before VAD fires, so the utterance start isn't clipped by VAD's hold delay. */
  preRollMs: number;
  /**
   * Whether to run rolling partial inferences at all. Off by default: a partial costs a
   * full inference (~13 s with the vendored single-threaded build), is never inserted
   * downstream, and delays the final queued behind it — measured runs emitted no usable
   * partial at all. Turn it on only when inference is comfortably faster than real time.
   */
  enablePartials: boolean;
  /** How much new speech audio must arrive between partial inferences, when enabled. */
  partialIntervalMs: number;
  /** An utterance is force-finalized at this length (Whisper's window is 30 s). */
  maxUtteranceMs: number;
};

/** Placeholders — not benchmarked; see AGENTS.md "Performance targets" before tuning or claiming latency. */
export const DEFAULT_STREAMING_OPTIONS: StreamingOptions = {
  enablePartials: false,
  preRollMs: 300,
  partialIntervalMs: 1000,
  maxUtteranceMs: CHUNK_MS_DEFAULT, // user-tunable; see domain/tuning.ts
};

export type StreamingTranscriberDeps = {
  engine: TranscriptionEngine;
  vad: VoiceActivityDetector;
  stabilizer: TranscriptStabilizer;
  onEvent: (event: TranscriptEvent) => void;
};

const msToSamples = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
const samplesToMs = (samples: number) => (samples / SAMPLE_RATE) * 1000;

export class StreamingTranscriber {
  private readonly buffer = new RollingAudioBuffer();
  private options: StreamingOptions;
  private totalSamples = 0;
  private inSpeech = false;
  private samplesAtLastPartial = 0;
  /** Bumped whenever an utterance is finalized/reset, so late partials can tell they're stale. */
  private utteranceId = 0;
  /**
   * Bumped only by reset(). Inference is slower than real time, so a backlog of finals can
   * still be queued when a capture session ends; without this they would be transcribed and
   * emitted into the *next* session, typing what was said before into the new destination.
   */
  private generation = 0;
  private partialInFlight = false;
  /** Tail of the serialized inference chain; finals and flush() wait on it. */
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: StreamingTranscriberDeps,
    options: Partial<StreamingOptions> = {},
  ) {
    this.options = { ...DEFAULT_STREAMING_OPTIONS, ...options };
  }

  /**
   * Retunes the pipeline while it is running. A lowered `maxUtteranceMs` applies on the next
   * `pushAudio`, so an utterance already past the new cap is finalized immediately rather
   * than waiting out the old one.
   */
  setOptions(options: Partial<StreamingOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /** Feeds a chunk of 16 kHz mono PCM. Synchronous; inference runs in the background. */
  pushAudio(samples: Float32Array): void {
    this.buffer.append(samples);
    this.totalSamples += samples.length;
    const nowMs = samplesToMs(this.totalSamples);

    const vadEvent = this.deps.vad.processFrame(samples, nowMs);
    if (vadEvent?.type === "speech-start") {
      this.inSpeech = true;
      this.samplesAtLastPartial = this.totalSamples;
    } else if (vadEvent?.type === "speech-end" && this.inSpeech) {
      this.finalizeUtterance(nowMs);
      return;
    }

    if (!this.inSpeech) {
      this.buffer.trimToRecent(msToSamples(this.options.preRollMs));
      return;
    }

    if (samplesToMs(this.buffer.length) >= this.options.maxUtteranceMs) {
      this.finalizeUtterance(nowMs);
      this.inSpeech = true; // still talking; the next utterance starts empty
      this.samplesAtLastPartial = this.totalSamples;
      return;
    }

    if (
      this.options.enablePartials &&
      !this.partialInFlight &&
      samplesToMs(this.totalSamples - this.samplesAtLastPartial) >= this.options.partialIntervalMs
    ) {
      this.samplesAtLastPartial = this.totalSamples;
      this.startPartial(nowMs);
    }
  }

  /** Finalizes any utterance in progress and resolves once all inference has settled. */
  async flush(): Promise<void> {
    if (this.inSpeech) {
      this.finalizeUtterance(samplesToMs(this.totalSamples));
      this.deps.vad.reset(); // its "speech" state no longer matches ours
    }
    await this.pending;
  }

  /**
   * Discards buffered audio and in-progress state. Results of inference that is in flight
   * or still queued are dropped rather than emitted, so nothing from before the reset can
   * surface afterwards.
   */
  reset(): void {
    this.buffer.clear();
    this.deps.vad.reset();
    this.deps.stabilizer.reset();
    this.inSpeech = false;
    this.utteranceId++;
    this.generation++;
    this.samplesAtLastPartial = this.totalSamples;
  }

  private startPartial(timestamp: number): void {
    const id = this.utteranceId;
    const generation = this.generation;
    const audio = this.buffer.snapshot();
    this.partialInFlight = true;
    this.pending = this.pending.then(async () => {
      try {
        if (generation !== this.generation) return;
        const { text } = await this.deps.engine.transcribe(audio);
        if (id !== this.utteranceId) return;
        const event = this.deps.stabilizer.onHypothesis(text, timestamp);
        if (event) this.deps.onEvent(event);
      } catch (err) {
        this.emitError(err);
      } finally {
        this.partialInFlight = false;
      }
    });
  }

  private finalizeUtterance(timestamp: number): void {
    const audio = this.buffer.snapshot();
    const generation = this.generation;
    this.buffer.clear();
    this.inSpeech = false;
    this.utteranceId++;
    if (audio.length === 0) return;

    this.pending = this.pending.then(async () => {
      // Queued behind however much inference is already in flight, so by the time this
      // runs the session it belongs to may be over (see `generation`).
      if (generation !== this.generation) return;
      try {
        const { text } = await this.deps.engine.transcribe(audio);
        if (generation !== this.generation) return; // reset while this was in flight
        const event = this.deps.stabilizer.onFinal(text, timestamp);
        if (event) this.deps.onEvent(event);
      } catch (err) {
        this.deps.stabilizer.reset();
        this.emitError(err);
      }
    });
  }

  private emitError(err: unknown): void {
    this.deps.onEvent({
      type: "error",
      code: "transcription-failed",
      message: err instanceof Error ? err.message : "Transcription failed.",
    });
  }
}

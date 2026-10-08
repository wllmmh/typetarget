/**
 * Dispatches between transcription providers by MODEL_CATALOG[modelId].provider,
 * presenting one object that satisfies both shapes asr-worker-controller.ts depends on
 * (TranscriptionEngine for status; StreamingTranscriber's narrow streaming shape for
 * audio in, events out), so the controller doesn't know which provider is active.
 *
 * Each provider supplies an `engine` and a `transcriber`. For whisper-cpp and groq these
 * are an instrumented engine and the StreamingTranscriber around it (see main.ts); for
 * gemini-live both are the same GeminiLiveEngine, which implements both shapes.
 */
import { MODEL_CATALOG, type EngineProvider, type EngineStatus, type ModelId, type TranscriptionEngine, type TranscriptionOptions, type TranscriptionResult } from "../domain/models";
import type { StreamingOptions, StreamingTranscriber } from "./streaming-transcriber";

export type ProviderImpl = {
  engine: TranscriptionEngine;
  transcriber: Pick<StreamingTranscriber, "pushAudio" | "flush" | "reset" | "setOptions">;
};

export type EngineRouterConfig = {
  providers: Record<EngineProvider, ProviderImpl>;
};

export class EngineRouter implements TranscriptionEngine {
  private active: ProviderImpl | null = null;

  constructor(private readonly config: EngineRouterConfig) {}

  async load(modelId: ModelId): Promise<void> {
    const provider = MODEL_CATALOG[modelId].provider;
    const next = this.config.providers[provider];
    if (this.active && this.active !== next) {
      await this.active.engine.unload().catch(() => {
        // The provider being switched away from failing to unload cleanly shouldn't
        // block switching to the one the user actually asked for.
      });
    }
    this.active = next;
    await next.engine.load(modelId);
  }

  async unload(): Promise<void> {
    await this.active?.engine.unload();
    this.active = null;
  }

  async transcribe(audio: Float32Array, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    if (!this.active) throw new Error("No transcription engine loaded.");
    return this.active.engine.transcribe(audio, options);
  }

  /** Satisfies both TranscriptionEngine.reset(): Promise<void> and the streaming
   * shape's reset(): void — Promise.resolve(...) normalizes either return so this one
   * implementation works as both. */
  async reset(): Promise<void> {
    await Promise.resolve(this.active?.transcriber.reset());
  }

  getStatus(): EngineStatus {
    return this.active?.engine.getStatus() ?? { state: "unloaded" };
  }

  pushAudio(samples: Float32Array): void {
    this.active?.transcriber.pushAudio(samples);
  }

  async flush(): Promise<void> {
    await this.active?.transcriber.flush();
  }

  setOptions(options: Partial<StreamingOptions>): void {
    this.active?.transcriber.setOptions(options);
  }
}

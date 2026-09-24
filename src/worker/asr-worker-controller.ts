/**
 * Message-handling logic of the ASR worker, kept free of worker globals (`self`,
 * `postMessage`, `importScripts`) so it can be tested with fakes; src/worker/main.ts
 * is the thin shell that wires it to the real worker environment.
 */
import type { ApiKeyProvider } from "../domain/api-key";
import type { TranscriptionEngine } from "../domain/models";
import type { StreamingTranscriber } from "./streaming-transcriber";
import type { AsrWorkerEvent, AsrWorkerRequest } from "./worker-protocol";

export type AsrWorkerController = {
  handle: (request: AsrWorkerRequest) => Promise<void>;
};

export type AsrWorkerControllerDeps = {
  engine: TranscriptionEngine;
  transcriber: Pick<StreamingTranscriber, "pushAudio" | "flush" | "reset" | "setOptions">;
  post: (event: AsrWorkerEvent) => void;
  /** Stores a network provider's API key for whichever engine reads it next (see
   * domain/api-key.ts). Optional so fakes that never exercise this path don't need it. */
  onSetApiKey?: (provider: ApiKeyProvider, apiKey: string) => void;
};

export const createAsrWorkerController = ({ engine, transcriber, post, onSetApiKey }: AsrWorkerControllerDeps): AsrWorkerController => {
  const postStatus = () => post({ kind: "engine-status", status: engine.getStatus() });

  const handle = async (request: AsrWorkerRequest): Promise<void> => {
    switch (request.kind) {
      case "load-model": {
        transcriber.reset();
        const loading = engine.load(request.modelId);
        postStatus(); // "loading" — the engine sets it synchronously when load() starts
        try {
          await loading;
        } catch {
          // The failure is reported through the engine's "error" status below.
        }
        postStatus();
        return;
      }
      case "unload-model":
        transcriber.reset();
        await engine.unload();
        postStatus();
        return;
      case "audio":
        // Audio arriving before a model is ready is dropped, not queued: there is
        // nothing to transcribe it with, and stale audio would be worthless later.
        if (engine.getStatus().state === "ready") transcriber.pushAudio(request.samples);
        return;
      case "flush":
        await transcriber.flush();
        post({ kind: "flushed" });
        return;
      case "reset":
        transcriber.reset();
        return;
      case "set-chunk-ms":
        transcriber.setOptions({ maxUtteranceMs: request.chunkMs });
        return;
      case "set-api-key":
        onSetApiKey?.(request.provider, request.apiKey);
        return;
      default: {
        const _exhaustive: never = request;
        return _exhaustive;
      }
    }
  };

  return { handle };
};

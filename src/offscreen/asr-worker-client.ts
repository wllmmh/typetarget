/** Offscreen-document side of the ASR worker: owns the Worker and gives it a typed send/subscribe surface. */
import type { AsrWorkerEvent, AsrWorkerRequest } from "../worker/worker-protocol";

export type AsrWorkerClient = {
  send: (request: AsrWorkerRequest) => void;
  /** Sends 16 kHz mono PCM, transferring (not copying) the buffer. */
  sendAudio: (samples: Float32Array) => void;
  terminate: () => void;
};

export const createAsrWorkerClient = (onEvent: (event: AsrWorkerEvent) => void): AsrWorkerClient => {
  // Vite bundles this as an IIFE (classic) worker — required, see src/worker/main.ts.
  const worker = new Worker(new URL("../worker/main.ts", import.meta.url));
  worker.onmessage = (message: MessageEvent<AsrWorkerEvent>) => onEvent(message.data);

  return {
    send: (request) => worker.postMessage(request),
    sendAudio: (samples) => worker.postMessage({ kind: "audio", samples }, [samples.buffer]),
    terminate: () => worker.terminate(),
  };
};

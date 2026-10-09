/**
 * Downloads a model file with progress reporting, checks it against its pinned SHA-256, then
 * hands it to model-cache.ts for persistence. Fetching and storing are kept in separate modules.
 */
import type { WhisperModelId } from "../domain/models";
import { getCachedModel, putCachedModel, isModelCached } from "./model-cache";

export type DownloadProgress = { receivedBytes: number; totalBytes: number };

/** Where each model's file is downloaded from, and the SHA-256 (lowercase hex) it must have. */
export type ModelSource = Record<WhisperModelId, { url: string; sha256: string }>;

const sha256Hex = async (data: ArrayBuffer): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Fetches and caches a model if not already cached, reporting progress via
 * `onProgress`. Returns the model bytes either way (from cache or freshly
 * downloaded), so callers don't need to branch on cache state themselves. A download whose
 * hash doesn't match is rejected and never cached, so only verified bytes reach the cache.
 */
export const ensureModelDownloaded = async (
  modelId: WhisperModelId,
  modelFiles: ModelSource,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<ArrayBuffer> => {
  if (await isModelCached(modelId)) {
    const cached = await getCachedModel(modelId);
    if (cached) return cached;
  }

  const { url, sha256 } = modelFiles[modelId];
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download model "${modelId}" (HTTP ${response.status}).`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    chunks.push(chunk.value);
    receivedBytes += chunk.value.length;
    onProgress?.({ receivedBytes, totalBytes });
  }

  const buffer = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  if ((await sha256Hex(buffer.buffer)) !== sha256) {
    throw new Error(`Downloaded model "${modelId}" failed its integrity check, so it was discarded. Try again later.`);
  }

  await putCachedModel(modelId, buffer.buffer);
  return buffer.buffer;
};

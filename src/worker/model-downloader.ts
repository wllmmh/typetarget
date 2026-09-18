/**
 * Downloads a model file with progress reporting, then hands it to model-cache.ts
 * for persistence. Kept separate from model-cache.ts because "fetch bytes from the
 * network with progress" and "persist bytes locally" are different concerns (one
 * network-shaped, one storage-shaped) — AGENTS.md "Separate these concerns."
 */
import type { ModelId } from "../domain/models";
import { getCachedModel, putCachedModel, isModelCached } from "./model-cache";

export type DownloadProgress = { receivedBytes: number; totalBytes: number };

export type ModelSource = Record<ModelId, string>;

/**
 * Fetches and caches a model if not already cached, reporting progress via
 * `onProgress`. Returns the model bytes either way (from cache or freshly
 * downloaded), so callers don't need to branch on cache state themselves.
 */
export const ensureModelDownloaded = async (
  modelId: ModelId,
  modelUrls: ModelSource,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<ArrayBuffer> => {
  if (await isModelCached(modelId)) {
    const cached = await getCachedModel(modelId);
    if (cached) return cached;
  }

  const url = modelUrls[modelId];
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

  await putCachedModel(modelId, buffer.buffer);
  return buffer.buffer;
};

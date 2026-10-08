/**
 * IndexedDB-backed cache for downloaded GGML model files, so each model is downloaded
 * once rather than on every start (docs/adr/0003-models-downloaded-at-runtime-and-cached.md).
 *
 * Deliberately generic (ModelId -> ArrayBuffer) — knows nothing about whisper.cpp's
 * on-disk model format, only that it's storing/retrieving bytes under an id.
 */
import type { ModelId } from "../domain/models";

const DB_NAME = "typetarget-models";
const DB_VERSION = 1;
const STORE_NAME = "models";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open model cache database."));
  });

export const isModelCached = async (modelId: ModelId): Promise<boolean> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).count(modelId);
    request.onsuccess = () => resolve(request.result > 0);
    request.onerror = () => reject(request.error ?? new Error("Failed to check model cache."));
  });
};

export const getCachedModel = async (modelId: ModelId): Promise<ArrayBuffer | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(modelId);
    request.onsuccess = () => resolve((request.result as ArrayBuffer | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to read cached model."));
  });
};

export const putCachedModel = async (modelId: ModelId, data: ArrayBuffer): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, modelId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to cache model."));
  });
};

export const deleteCachedModel = async (modelId: ModelId): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(modelId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete cached model."));
  });
};

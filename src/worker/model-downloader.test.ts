import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { ensureModelDownloaded, type ModelSource } from "./model-downloader";
import { MODEL_FILES as REAL_MODEL_FILES } from "./model-urls";
import { isModelCached } from "./model-cache";

/** Every model needs a file; the ones these tests download point at example.com, with the
 * SHA-256 of the bytes each test serves. */
const MODEL_FILES: ModelSource = {
  ...REAL_MODEL_FILES,
  "tiny.en": { url: "https://example.com/tiny.en.bin", sha256: "74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0" }, // [1, 2, 3, 4, 5]
  "tiny.en-q5_1": { url: "https://example.com/tiny.en-q5_1.bin", sha256: "2b4c342f5433ebe591a1da77e013d1b72475562d48578dca8b84bac6651c3cb9" }, // [9]
};

/** Builds a fetch Response whose body streams the given chunks. */
const streamingResponse = (chunks: Uint8Array[], contentLength?: number): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new Response(stream, { status: 200, headers });
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.indexedDB = new IDBFactory();
});

describe("ensureModelDownloaded", () => {
  it("downloads, reports progress, and caches the model when not cached", async () => {
    const chunk1 = new Uint8Array([1, 2]);
    const chunk2 = new Uint8Array([3, 4, 5]);
    vi.mocked(fetch).mockResolvedValue(streamingResponse([chunk1, chunk2], 5));

    const onProgress = vi.fn();
    const result = await ensureModelDownloaded("tiny.en", MODEL_FILES, onProgress);

    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(onProgress).toHaveBeenCalledWith({ receivedBytes: 2, totalBytes: 5 });
    expect(onProgress).toHaveBeenCalledWith({ receivedBytes: 5, totalBytes: 5 });
    expect(await isModelCached("tiny.en")).toBe(true);
  });

  it("returns the cached model without fetching when already cached", async () => {
    vi.mocked(fetch).mockResolvedValue(streamingResponse([new Uint8Array([9])], 1));
    await ensureModelDownloaded("tiny.en-q5_1", MODEL_FILES);
    vi.mocked(fetch).mockClear();

    const result = await ensureModelDownloaded("tiny.en-q5_1", MODEL_FILES);

    expect(fetch).not.toHaveBeenCalled();
    expect(new Uint8Array(result)).toEqual(new Uint8Array([9]));
  });

  it("throws a descriptive error on a failed HTTP response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));

    await expect(ensureModelDownloaded("tiny.en", MODEL_FILES)).rejects.toThrow(/404/);
  });

  it("rejects and does not cache a download whose SHA-256 doesn't match", async () => {
    vi.mocked(fetch).mockResolvedValue(streamingResponse([new Uint8Array([6, 6, 6])], 3));

    await expect(ensureModelDownloaded("tiny.en", MODEL_FILES)).rejects.toThrow(/integrity check/);
    expect(await isModelCached("tiny.en")).toBe(false);
  });
});

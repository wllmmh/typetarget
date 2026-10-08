import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { ensureModelDownloaded, type ModelSource } from "./model-downloader";
import { MODEL_URLS as REAL_MODEL_URLS } from "./model-urls";
import { isModelCached } from "./model-cache";

/** Every model needs a URL; the ones these tests download point at example.com. */
const MODEL_URLS: ModelSource = {
  ...REAL_MODEL_URLS,
  "tiny.en": "https://example.com/tiny.en.bin",
  "tiny.en-q5_1": "https://example.com/tiny.en-q5_1.bin",
  "base.en": "https://example.com/base.en.bin",
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
    const result = await ensureModelDownloaded("tiny.en", MODEL_URLS, onProgress);

    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(onProgress).toHaveBeenCalledWith({ receivedBytes: 2, totalBytes: 5 });
    expect(onProgress).toHaveBeenCalledWith({ receivedBytes: 5, totalBytes: 5 });
    expect(await isModelCached("tiny.en")).toBe(true);
  });

  it("returns the cached model without fetching when already cached", async () => {
    vi.mocked(fetch).mockResolvedValue(streamingResponse([new Uint8Array([9])], 1));
    await ensureModelDownloaded("tiny.en", MODEL_URLS);
    vi.mocked(fetch).mockClear();

    const result = await ensureModelDownloaded("tiny.en", MODEL_URLS);

    expect(fetch).not.toHaveBeenCalled();
    expect(new Uint8Array(result)).toEqual(new Uint8Array([9]));
  });

  it("throws a descriptive error on a failed HTTP response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));

    await expect(ensureModelDownloaded("tiny.en", MODEL_URLS)).rejects.toThrow(/404/);
  });
});

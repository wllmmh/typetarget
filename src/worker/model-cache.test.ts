import { afterEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { isModelCached, getCachedModel, putCachedModel, deleteCachedModel } from "./model-cache";

// Fresh database per test: model-cache.ts's openDb() always targets the same DB
// name, so state would otherwise leak between tests. Recreating the global
// IDBFactory is fake-indexeddb's own documented reset mechanism.
afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("model cache", () => {
  it("reports not cached before anything is stored", async () => {
    expect(await isModelCached("tiny.en")).toBe(false);
    expect(await getCachedModel("tiny.en")).toBeNull();
  });

  it("stores and retrieves a model's bytes", async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    await putCachedModel("tiny.en", data);

    expect(await isModelCached("tiny.en")).toBe(true);
    const retrieved = await getCachedModel("tiny.en");
    expect(new Uint8Array(retrieved!)).toEqual(new Uint8Array(data));
  });

  it("keeps different models independent", async () => {
    await putCachedModel("tiny.en", new Uint8Array([1]).buffer);
    await putCachedModel("base.en", new Uint8Array([2]).buffer);

    expect(new Uint8Array((await getCachedModel("tiny.en"))!)).toEqual(new Uint8Array([1]));
    expect(new Uint8Array((await getCachedModel("base.en"))!)).toEqual(new Uint8Array([2]));
  });

  it("deletes a cached model", async () => {
    await putCachedModel("tiny.en", new Uint8Array([1]).buffer);
    await deleteCachedModel("tiny.en");

    expect(await isModelCached("tiny.en")).toBe(false);
  });

  it("overwrites a previously cached model with the same id", async () => {
    await putCachedModel("tiny.en", new Uint8Array([1]).buffer);
    await putCachedModel("tiny.en", new Uint8Array([9, 9]).buffer);

    expect(new Uint8Array((await getCachedModel("tiny.en"))!)).toEqual(new Uint8Array([9, 9]));
  });
});

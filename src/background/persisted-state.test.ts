import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { createInitialState } from "./state";
import { persistState, restorePersistedState, restrictLocalStorageToExtension } from "./persisted-state";
import { DEFAULT_MODEL } from "../domain/models";
import { UTTERANCE_CAP_MAX_MS } from "../domain/tuning";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persistState / restorePersistedState", () => {
  it("round-trips the user's picks so a reopened popup (or restarted worker) keeps them", async () => {
    const saved = createInitialState();
    saved.selectedModel = "tiny";
    saved.pendingSourceTabId = 42;
    saved.destination = { tabId: 7, frameId: 0, elementId: "el-1" };
    saved.destinationLabel = 'div "Add a comment..."';
    await persistState(saved);

    const restored = createInitialState();
    await restorePersistedState(restored);

    expect(restored.selectedModel).toBe("tiny");
    expect(restored.pendingSourceTabId).toBe(42);
    expect(restored.destination).toEqual({ tabId: 7, frameId: 0, elementId: "el-1" });
    expect(restored.destinationLabel).toBe('div "Add a comment..."');
  });

  it("falls back to the default model when the stored one is no longer offered", async () => {
    fake.storage.local.data.selectedModel = "tiny.en-q5_1";
    const restored = createInitialState();
    await restorePersistedState(restored);
    expect(restored.selectedModel).toBe(DEFAULT_MODEL);
  });

  it("keeps lasting preferences in local storage and tab-scoped bindings in session storage", async () => {
    const state = createInitialState();
    state.pendingSourceTabId = 3;
    await persistState(state);

    expect(Object.keys(fake.storage.local.data).sort()).toEqual(["apiKeys", "chunkMs", "selectedModel", "showPageIndicators", "spokenLanguage"]);
    expect(Object.keys(fake.storage.session.data)).toEqual(["binding"]);
  });

  it("round-trips the page indicators setting, and keeps the default (on) for a junk value", async () => {
    const saved = createInitialState();
    saved.showPageIndicators = false;
    await persistState(saved);
    const restored = createInitialState();
    await restorePersistedState(restored);
    expect(restored.showPageIndicators).toBe(false);

    fake.storage.local.data.showPageIndicators = "no";
    const junk = createInitialState();
    await restorePersistedState(junk);
    expect(junk.showPageIndicators).toBe(true);
  });

  it("round-trips a stored API key", async () => {
    const saved = createInitialState();
    saved.apiKeys["gemini-live"] = "test-gemini-key";
    await persistState(saved);

    const restored = createInitialState();
    await restorePersistedState(restored);

    expect(restored.apiKeys).toEqual({ "gemini-live": "test-gemini-key" });
  });

  it("drops junk API key entries left by an older build (unknown provider, non-string value, empty key)", async () => {
    fake.storage.local.data.apiKeys = { "gemini-live": "", groq: 12345, "not-a-provider": "some-key" };
    const state = createInitialState();

    await restorePersistedState(state);

    expect(state.apiKeys).toEqual({});
  });

  it("round-trips the chunk length, clamping a value out of range", async () => {
    const saved = createInitialState();
    saved.chunkMs = 9_000;
    await persistState(saved);
    const restored = createInitialState();
    await restorePersistedState(restored);
    expect(restored.chunkMs).toBe(9_000);

    fake.storage.local.data.chunkMs = 999_000;
    const outOfRange = createInitialState();
    await restorePersistedState(outOfRange);
    expect(outOfRange.chunkMs).toBe(UTTERANCE_CAP_MAX_MS);
  });

  it("round-trips the spoken language, and detects it for a code TypeTarget doesn't offer", async () => {
    const saved = createInitialState();
    saved.spokenLanguage = "fr";
    await persistState(saved);
    const restored = createInitialState();
    await restorePersistedState(restored);
    expect(restored.spokenLanguage).toBe("fr");

    fake.storage.local.data.spokenLanguage = "klingon";
    const junk = createInitialState();
    await restorePersistedState(junk);
    expect(junk.spokenLanguage).toBeNull();
  });

  it("falls back to defaults for junk left by an older build", async () => {
    fake.storage.local.data.selectedModel = "not-a-model";
    fake.storage.session.data.binding = { pendingSourceTabId: "42", destination: { tabId: 1 } };
    const state = createInitialState();

    await restorePersistedState(state);

    expect(state.selectedModel).toBe(createInitialState().selectedModel);
    expect(state.pendingSourceTabId).toBeNull();
    expect(state.destination).toBeNull();
  });

  it("leaves defaults in place when storage is unavailable", async () => {
    fake.storage.session.get.mockRejectedValue(new Error("no storage"));
    const state = createInitialState();

    await expect(restorePersistedState(state)).resolves.toBeNull();
    expect(state.pendingSourceTabId).toBeNull();
  });

  it("returns a running capture, for the restarted worker to check, without restoring it into state", async () => {
    const saved = createInitialState();
    saved.status = "paused";
    saved.sourceTabId = 42;
    saved.session = { since: 1_000, reconnects: 2, reconnecting: { attempt: 1, reason: "offline" } };
    await persistState(saved);

    const restored = createInitialState();
    const capture = await restorePersistedState(restored);

    expect(capture).toEqual({ sourceTabId: 42, session: { since: 1_000, reconnects: 2, reconnecting: null } });
    expect(restored.status).toBe("idle");
    expect(restored.sourceTabId).toBeNull();
  });

  it("returns no capture once capture has stopped", async () => {
    const saved = createInitialState();
    saved.status = "error";
    saved.sourceTabId = 42;
    await persistState(saved);

    expect(await restorePersistedState(createInitialState())).toBeNull();
  });

  it("does not reject when a write fails", async () => {
    fake.storage.local.set.mockRejectedValue(new Error("quota"));
    await expect(persistState(createInitialState())).resolves.toBeUndefined();
  });

  it("keeps local storage, where API keys live, away from content scripts", async () => {
    await restrictLocalStorageToExtension();

    expect(fake.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("does not reject when the access level can't be set", async () => {
    fake.storage.local.setAccessLevel.mockRejectedValue(new Error("unsupported"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(restrictLocalStorageToExtension()).resolves.toBeUndefined();
  });
});

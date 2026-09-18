import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { envelope, isEnvelope, type BackgroundToOffscreen } from "../domain/messages";
import { CaptureController, CaptureError } from "./capture-controller";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Makes the fake tabCapture.getMediaStreamId succeed with the given id. */
const stubStreamId = (streamId: string) => {
  fake.tabCapture.getMediaStreamId.mockImplementation(
    (_opts: unknown, cb: (id: string) => void) => cb(streamId),
  );
};

/** Makes runtime.sendMessage answer as the offscreen document would, for start/stop. */
const stubOffscreenOk = () => {
  fake.runtime.sendMessage.mockImplementation(async (msg: unknown) => {
    if (isEnvelope<BackgroundToOffscreen>(msg)) {
      return envelope({ kind: "ok" });
    }
    return undefined;
  });
};

describe("CaptureController.start", () => {
  it("throws a CaptureError when the source tab is gone", async () => {
    fake.tabs.get.mockRejectedValue(new Error("No tab with id"));
    const controller = new CaptureController({ onSourceTabClosed: vi.fn() });

    await expect(controller.start(42)).rejects.toThrow(CaptureError);
    await expect(controller.start(42)).rejects.toMatchObject({ code: "source-tab-missing" });
  });

  it("throws a CaptureError when Chrome provides no stream id", async () => {
    fake.tabs.get.mockResolvedValue({ id: 42 });
    fake.tabCapture.getMediaStreamId.mockImplementation((_opts: unknown, cb: (id: string) => void) => {
      fake.runtime.lastError = { message: "denied" };
      cb(undefined as unknown as string);
    });
    const controller = new CaptureController({ onSourceTabClosed: vi.fn() });

    await expect(controller.start(42)).rejects.toMatchObject({ code: "capture-failed" });
  });

  it("throws a CaptureError when the offscreen document reports failure", async () => {
    fake.tabs.get.mockResolvedValue({ id: 42 });
    stubStreamId("stream-1");
    fake.runtime.sendMessage.mockResolvedValue(
      envelope({ kind: "error", code: "capture-failed", message: "getUserMedia rejected" }),
    );
    const controller = new CaptureController({ onSourceTabClosed: vi.fn() });

    await expect(controller.start(42)).rejects.toMatchObject({
      code: "capture-failed",
      message: "getUserMedia rejected",
    });
  });

  it("succeeds and registers a tab-removal listener when everything checks out", async () => {
    fake.tabs.get.mockResolvedValue({ id: 42 });
    stubStreamId("stream-1");
    stubOffscreenOk();
    const controller = new CaptureController({ onSourceTabClosed: vi.fn() });

    await controller.start(42);

    expect(controller.currentSourceTabId).toBe(42);
    expect(fake.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(fake.tabs.onRemoved.hasListener).toHaveBeenCalled();
  });
});

describe("CaptureController source-tab closure", () => {
  it("notifies via onSourceTabClosed when the captured tab closes", async () => {
    fake.tabs.get.mockResolvedValue({ id: 42 });
    stubStreamId("stream-1");
    stubOffscreenOk();
    const onSourceTabClosed = vi.fn();
    const controller = new CaptureController({ onSourceTabClosed });

    await controller.start(42);
    fake.tabs.onRemoved.emit(42);

    expect(onSourceTabClosed).toHaveBeenCalledTimes(1);
    expect(controller.currentSourceTabId).toBeNull();
  });

  it("ignores closures of unrelated tabs", async () => {
    fake.tabs.get.mockResolvedValue({ id: 42 });
    stubStreamId("stream-1");
    stubOffscreenOk();
    const onSourceTabClosed = vi.fn();
    const controller = new CaptureController({ onSourceTabClosed });

    await controller.start(42);
    fake.tabs.onRemoved.emit(999);

    expect(onSourceTabClosed).not.toHaveBeenCalled();
    expect(controller.currentSourceTabId).toBe(42);
  });
});

describe("CaptureController.stop", () => {
  it("stops capture, closes the offscreen document, and unregisters the listener", async () => {
    fake.tabs.get.mockResolvedValue({ id: 42 });
    stubStreamId("stream-1");
    stubOffscreenOk();
    // Reflects that ensureOffscreenDocument() (called during start()) has created one.
    fake.runtime.getContexts.mockResolvedValue([{ contextType: "OFFSCREEN_DOCUMENT" }]);
    const controller = new CaptureController({ onSourceTabClosed: vi.fn() });
    await controller.start(42);

    await controller.stop();

    expect(controller.currentSourceTabId).toBeNull();
    expect(fake.tabs.onRemoved.removeListener).toHaveBeenCalled();
    expect(fake.offscreen.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("is safe to call even when the offscreen document is already gone", async () => {
    fake.runtime.sendMessage.mockRejectedValue(new Error("no receiving end"));
    const controller = new CaptureController({ onSourceTabClosed: vi.fn() });

    await expect(controller.stop()).resolves.toBeUndefined();
  });
});

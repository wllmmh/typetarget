import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { getTabCaptureStreamId } from "./tab-capture";
import { vi } from "vitest";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTabCaptureStreamId", () => {
  it("resolves with the stream id Chrome returns", async () => {
    fake.tabCapture.getMediaStreamId.mockImplementation((_opts, cb: (id: string) => void) => cb("abc123"));

    await expect(getTabCaptureStreamId(7)).resolves.toBe("abc123");
    expect(fake.tabCapture.getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 7 }, expect.any(Function));
  });

  it("turns a missing activeTab grant into instructions the user can act on", async () => {
    fake.tabCapture.getMediaStreamId.mockImplementation((_opts, cb: (id: string) => void) => {
      fake.runtime.lastError = { message: "Extension has not been invoked for the current page" };
      cb(undefined as unknown as string);
    });

    // The one failure people actually hit: Chrome's own wording says nothing about the fix.
    await expect(getTabCaptureStreamId(7)).rejects.toThrow(/click the WaveType toolbar button there/);
  });

  it("passes any other Chrome error through, so unexpected causes stay diagnosable", async () => {
    fake.tabCapture.getMediaStreamId.mockImplementation((_opts, cb: (id: string) => void) => {
      fake.runtime.lastError = { message: "Error starting tab capture" };
      cb(undefined as unknown as string);
    });

    await expect(getTabCaptureStreamId(7)).rejects.toThrow(/Error starting tab capture/);
  });

  it("rejects with a fallback message when there is no stream id and no lastError", async () => {
    fake.tabCapture.getMediaStreamId.mockImplementation((_opts, cb: (id: string) => void) =>
      cb(undefined as unknown as string),
    );

    await expect(getTabCaptureStreamId(7)).rejects.toThrow(/did not return/i);
  });
});

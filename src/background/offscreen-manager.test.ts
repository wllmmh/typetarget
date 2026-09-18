import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { ensureOffscreenDocument, closeOffscreenDocument } from "./offscreen-manager";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureOffscreenDocument", () => {
  it("creates a document when none exists", async () => {
    fake.runtime.getContexts.mockResolvedValue([]);

    await ensureOffscreenDocument();

    expect(fake.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(fake.offscreen.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: ["USER_MEDIA"] }),
    );
  });

  it("does not create a second document when one already exists", async () => {
    fake.runtime.getContexts.mockResolvedValue([{ contextType: "OFFSCREEN_DOCUMENT" }]);

    await ensureOffscreenDocument();

    expect(fake.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it("collapses concurrent calls into a single createDocument invocation", async () => {
    fake.runtime.getContexts.mockResolvedValue([]);

    const first = ensureOffscreenDocument();
    const second = ensureOffscreenDocument();
    await Promise.all([first, second]);

    expect(fake.offscreen.createDocument).toHaveBeenCalledTimes(1);
  });
});

describe("closeOffscreenDocument", () => {
  it("closes only when a document exists", async () => {
    fake.runtime.getContexts.mockResolvedValue([]);
    await closeOffscreenDocument();
    expect(fake.offscreen.closeDocument).not.toHaveBeenCalled();

    fake.runtime.getContexts.mockResolvedValue([{ contextType: "OFFSCREEN_DOCUMENT" }]);
    await closeOffscreenDocument();
    expect(fake.offscreen.closeDocument).toHaveBeenCalledTimes(1);
  });
});

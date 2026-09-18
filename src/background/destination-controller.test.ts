import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { envelope } from "../domain/messages";
import { DestinationController, DestinationError } from "./destination-controller";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
  fake.tabs.sendMessage.mockResolvedValue(envelope({ kind: "ok" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DestinationController.beginSelection", () => {
  it("injects the content script into the active tab and enters selection mode", async () => {
    fake.tabs.query.mockResolvedValue([{ id: 5 }]);
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });

    await controller.beginSelection();

    expect(fake.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 5, allFrames: true } }),
    );
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(5, envelope({ kind: "enter-selection-mode" }));
    expect(controller.isSelecting).toBe(true);
  });

  it("throws when there is no active tab", async () => {
    fake.tabs.query.mockResolvedValue([]);
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });

    await expect(controller.beginSelection()).rejects.toBeInstanceOf(DestinationError);
  });

  it("throws when injection fails", async () => {
    fake.tabs.query.mockResolvedValue([{ id: 5 }]);
    fake.scripting.executeScript.mockRejectedValue(new Error("Cannot access a chrome:// URL"));
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });

    await expect(controller.beginSelection()).rejects.toMatchObject({ code: "injection-failed" });
  });
});

describe("DestinationController.handlePicked", () => {
  it("invokes onPicked and exits selecting state for the tab that was being selected in", async () => {
    fake.tabs.query.mockResolvedValue([{ id: 5 }]);
    const onPicked = vi.fn();
    const controller = new DestinationController({ onPicked, onUnavailable: vi.fn() });
    await controller.beginSelection();

    controller.handlePicked(5, 0, "el-1", "textarea");

    expect(onPicked).toHaveBeenCalledWith({ tabId: 5, frameId: 0, elementId: "el-1" }, "textarea");
    expect(controller.isSelecting).toBe(false);
  });

  it("ignores a pick reported from a tab that is not the one being selected in", async () => {
    fake.tabs.query.mockResolvedValue([{ id: 5 }]);
    const onPicked = vi.fn();
    const controller = new DestinationController({ onPicked, onUnavailable: vi.fn() });
    await controller.beginSelection();

    controller.handlePicked(999, 0, "el-1", "textarea");

    expect(onPicked).not.toHaveBeenCalled();
    expect(controller.isSelecting).toBe(true);
  });
});

describe("DestinationController.insertText / checkAlive", () => {
  it("reports unavailable when the destination tab can't be reached", async () => {
    fake.tabs.sendMessage.mockRejectedValue(new Error("Could not establish connection"));
    const onUnavailable = vi.fn();
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable });

    await controller.insertText({ tabId: 5, frameId: 0, elementId: "el-1" }, "hello", " ");

    expect(onUnavailable).toHaveBeenCalledWith("Destination tab is no longer available.");
  });

  it("does not report unavailable when insertion succeeds", async () => {
    const onUnavailable = vi.fn();
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable });

    await controller.insertText({ tabId: 5, frameId: 0, elementId: "el-1" }, "hello", " ");

    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

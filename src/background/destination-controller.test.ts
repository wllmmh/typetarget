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

describe("DestinationController.pickFromContextMenu", () => {
  it("injects into only the right-clicked frame, asks it to pick, and accepts the pick from another tab", async () => {
    fake.tabs.query.mockResolvedValue([{ id: 5 }]);
    const onPicked = vi.fn();
    const controller = new DestinationController({ onPicked, onUnavailable: vi.fn() });
    await controller.beginSelection(); // "Select output" was clicked in tab 5 (the source)

    await controller.pickFromContextMenu(9, 2);

    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(5, envelope({ kind: "exit-selection-mode" }));
    expect(fake.scripting.executeScript).toHaveBeenLastCalledWith(expect.objectContaining({ target: { tabId: 9, frameIds: [2] } }));
    expect(fake.tabs.sendMessage).toHaveBeenLastCalledWith(9, envelope({ kind: "pick-focused-element" }), { frameId: 2 });
    controller.handlePicked(9, 2, "el-1", "div");
    expect(onPicked).toHaveBeenCalledWith({ tabId: 9, frameId: 2, elementId: "el-1" }, "div");
  });

  it("throws the page's reason when no text box is focused there", async () => {
    fake.tabs.sendMessage.mockResolvedValue(envelope({ kind: "error", code: "no-focused-text-box", message: "couldn't find it" }));
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });

    await expect(controller.pickFromContextMenu(9, 0)).rejects.toMatchObject({ code: "no-focused-text-box", message: "couldn't find it" });
    expect(controller.isSelecting).toBe(false);
  });

  it("throws when the page can't be injected into", async () => {
    fake.scripting.executeScript.mockRejectedValue(new Error("Cannot access contents of the page"));
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });

    await expect(controller.pickFromContextMenu(9, 0)).rejects.toMatchObject({ code: "injection-failed" });
  });
});

describe("DestinationController.followTo", () => {
  it("extends selection mode into a tab the user switches to, and a pick there wins", async () => {
    fake.tabs.query.mockResolvedValue([{ id: 5 }]);
    const onPicked = vi.fn();
    const controller = new DestinationController({ onPicked, onUnavailable: vi.fn() });
    await controller.beginSelection(); // clicked "Select output" on the source tab (5)

    await expect(controller.followTo(9)).resolves.toBe(true);
    expect(fake.scripting.executeScript).toHaveBeenLastCalledWith(expect.objectContaining({ target: { tabId: 9, allFrames: true } }));
    expect(fake.tabs.sendMessage).toHaveBeenLastCalledWith(9, envelope({ kind: "enter-selection-mode" }));

    controller.handlePicked(9, 0, "el-1", "textarea");

    expect(onPicked).toHaveBeenCalledWith({ tabId: 9, frameId: 0, elementId: "el-1" }, "textarea");
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(5, envelope({ kind: "exit-selection-mode" }));
    expect(controller.isSelecting).toBe(false);
  });

  it("reports a tab TypeTarget can't reach, and keeps selecting where it already was", async () => {
    fake.tabs.query.mockResolvedValue([{ id: 5 }]);
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });
    await controller.beginSelection();
    fake.scripting.executeScript.mockRejectedValueOnce(new Error("Cannot access contents of the page."));

    await expect(controller.followTo(9)).resolves.toBe(false);
    expect(controller.isSelecting).toBe(true);
  });

  it("does nothing when no selection is in progress", async () => {
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });

    await expect(controller.followTo(9)).resolves.toBe(true);
    expect(fake.scripting.executeScript).not.toHaveBeenCalled();
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

  // Injection is allFrames (the destination may be inside an iframe), so a tab-wide send
  // reaches frames that never picked anything; each answered "destination-unavailable",
  // which unbinds the destination the user did pick.
  it("addresses only the frame that owns the destination element", async () => {
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable: vi.fn() });

    await controller.insertText({ tabId: 5, frameId: 3, elementId: "el-1" }, "hello", " ");
    await controller.checkAlive({ tabId: 5, frameId: 3, elementId: "el-1" });

    expect(fake.tabs.sendMessage).toHaveBeenNthCalledWith(
      1,
      5,
      envelope({ kind: "insert-text", text: "hello", separator: " " }),
      { frameId: 3 },
    );
    expect(fake.tabs.sendMessage).toHaveBeenNthCalledWith(2, 5, envelope({ kind: "check-destination-alive" }), {
      frameId: 3,
    });
  });

  it("releases a destination by messaging only its own frame, ignoring a tab that is gone", async () => {
    const onUnavailable = vi.fn();
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable });

    await controller.release({ tabId: 5, frameId: 3, elementId: "el-1" });
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(5, envelope({ kind: "clear-destination" }), { frameId: 3 });

    fake.tabs.sendMessage.mockRejectedValueOnce(new Error("No tab with id: 5"));
    await expect(controller.release({ tabId: 5, frameId: 3, elementId: "el-1" })).resolves.toBeUndefined();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("does not report unavailable when insertion succeeds", async () => {
    const onUnavailable = vi.fn();
    const controller = new DestinationController({ onPicked: vi.fn(), onUnavailable });

    await controller.insertText({ tabId: 5, frameId: 0, elementId: "el-1" }, "hello", " ");

    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destinationSession } from "./destination-session";

describe("destinationSession", () => {
  let textarea: HTMLTextAreaElement;

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.append(textarea);
  });

  afterEach(() => {
    destinationSession.stopSelecting();
    destinationSession.clearDestination();
    destinationSession.onPicked = null;
    textarea.remove();
    document.body.innerHTML = "";
  });

  it("picks an eligible element on click while selecting, and reports it via onPicked", () => {
    const onPicked = vi.fn();
    destinationSession.onPicked = onPicked;
    destinationSession.startSelecting();

    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onPicked).toHaveBeenCalledTimes(1);
    expect(onPicked).toHaveBeenCalledWith(expect.objectContaining({ label: "textarea" }));
  });

  it("does not pick anything when not in selection mode", () => {
    const onPicked = vi.fn();
    destinationSession.onPicked = onPicked;

    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onPicked).not.toHaveBeenCalled();
  });

  it("reports isDestinationAlive() false before anything is picked, true after, false once removed", () => {
    expect(destinationSession.isDestinationAlive()).toBe(false);

    destinationSession.startSelecting();
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(destinationSession.isDestinationAlive()).toBe(true);

    textarea.remove();
    expect(destinationSession.isDestinationAlive()).toBe(false);
  });

  it("inserts text at the captured boundary and advances it on subsequent inserts", () => {
    textarea.value = "existing";
    destinationSession.startSelecting();
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const first = destinationSession.insert("first final", " ");
    expect(first).toBe(true);
    expect(textarea.value).toBe("existing first final");

    const second = destinationSession.insert("second final", " ");
    expect(second).toBe(true);
    expect(textarea.value).toBe("existing first final second final");
  });

  it("insert() returns false once the destination element is gone", () => {
    destinationSession.startSelecting();
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    textarea.remove();

    expect(destinationSession.insert("text", " ")).toBe(false);
  });

  it("insert() returns false when nothing has been picked", () => {
    expect(destinationSession.insert("text", " ")).toBe(false);
  });

  it("outlines the picked element until the destination is cleared", () => {
    destinationSession.startSelecting();
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(textarea.classList.contains("typetarget-destination")).toBe(true);
    expect(document.getElementById("typetarget-destination-style")?.textContent).toContain("double");

    destinationSession.clearDestination();

    expect(textarea.classList.contains("typetarget-destination")).toBe(false);
    expect(document.getElementById("typetarget-destination-style")).toBeNull();
  });

  it("moves the outline when a different element is picked", () => {
    const other = document.createElement("textarea");
    document.body.append(other);
    destinationSession.startSelecting();
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    destinationSession.startSelecting();
    other.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(textarea.classList.contains("typetarget-destination")).toBe(false);
    expect(other.classList.contains("typetarget-destination")).toBe(true);
  });

  it("keeps the destination outline when selection mode ends", () => {
    destinationSession.startSelecting();
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); // ends selection mode
    destinationSession.startSelecting();
    destinationSession.stopSelecting();

    expect(textarea.classList.contains("typetarget-destination")).toBe(true);
    expect(document.getElementById("typetarget-destination-style")).not.toBeNull();
  });

  it("reports the pointer entering and leaving the picked element, until it's cleared", () => {
    const onPointerOverDestination = vi.fn();
    destinationSession.onPointerOverDestination = onPointerOverDestination;
    destinationSession.startSelecting();
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    textarea.dispatchEvent(new Event("pointerenter"));
    textarea.dispatchEvent(new Event("pointerleave"));
    expect(onPointerOverDestination.mock.calls).toEqual([[true], [false]]);

    destinationSession.clearDestination();
    textarea.dispatchEvent(new Event("pointerenter"));
    expect(onPointerOverDestination).toHaveBeenCalledTimes(2);
    destinationSession.onPointerOverDestination = null;
  });

  it("stopSelecting removes listeners so subsequent clicks are ignored", () => {
    const onPicked = vi.fn();
    destinationSession.onPicked = onPicked;
    destinationSession.startSelecting();
    destinationSession.stopSelecting();

    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onPicked).not.toHaveBeenCalled();
  });
});

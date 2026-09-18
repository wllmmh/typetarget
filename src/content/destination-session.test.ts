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

  it("stopSelecting removes listeners so subsequent clicks are ignored", () => {
    const onPicked = vi.fn();
    destinationSession.onPicked = onPicked;
    destinationSession.startSelecting();
    destinationSession.stopSelecting();

    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onPicked).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import { destinationSession } from "./destination-session";
import { NEW_FILE_FIELD_ID } from "./new-file-field";
import { isUserEvent } from "./user-event";

// jsdom never makes a trusted event, so these tests' clicks stand in for the user's own.
vi.mock("./user-event", () => ({ isUserEvent: vi.fn(() => true) }));

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

  it("ignores a click a page script dispatched while selecting, and keeps selecting", () => {
    const onPicked = vi.fn();
    destinationSession.onPicked = onPicked;
    destinationSession.startSelecting();
    vi.mocked(isUserEvent).mockReturnValueOnce(false);

    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onPicked).not.toHaveBeenCalled();

    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onPicked).toHaveBeenCalledTimes(1);
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

  describe("Type to new file", () => {
    const newFileField = () => document.getElementById(NEW_FILE_FIELD_ID);

    it("opens a focused text box fixed over the bottom third of the page and picks it", () => {
      const onPicked = vi.fn();
      destinationSession.onPicked = onPicked;

      destinationSession.openNewFileField();

      const field = newFileField();
      expect(field).toBeInstanceOf(HTMLTextAreaElement);
      expect(document.activeElement).toBe(field);
      expect(field?.style.position).toBe("fixed");
      expect(field?.style.bottom).toBe("12px"); // a margin on the left, right and below
      expect(field?.style.left).toBe("12px");
      expect(field?.style.height).toMatch(/33\.33/); // a third of the viewport, however the browser serializes it
      expect(field?.classList.contains("typetarget-destination")).toBe(true);
      expect(onPicked).toHaveBeenCalledWith(expect.objectContaining({ label: "TypeTarget new file" }));
      expect(destinationSession.insert("hello", " ")).toBe(true);
      expect(field).toHaveValue("hello");
    });

    it("reuses the open box instead of opening a second one", () => {
      destinationSession.openNewFileField();
      destinationSession.insert("hello", " ");

      destinationSession.openNewFileField();

      expect(document.querySelectorAll(`#${NEW_FILE_FIELD_ID}`)).toHaveLength(1);
      expect(newFileField()).toHaveValue("hello");
    });

    it("opens with the text moved back from the editor tab, and types after it", () => {
      destinationSession.openNewFileField("from the editor");

      destinationSession.insert("then more", " ");

      expect(newFileField()).toHaveValue("from the editor then more");
    });

    it("opens minimized when asked, with the text it was given", () => {
      destinationSession.openNewFileField("typed on the page", true);

      expect(newFileField()).toHaveValue("typed on the page");
      expect(newFileField()?.style.height).toBe("46.5px");
    });

    it("closes the box when typing stops", () => {
      destinationSession.openNewFileField();

      destinationSession.clearDestination();

      expect(newFileField()).toBeNull();
    });

    it("moves the box's text into the text box that becomes the output in its place", () => {
      destinationSession.openNewFileField();
      destinationSession.insert("said so far", " ");
      textarea.value = "already here";

      destinationSession.startSelecting();
      textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      destinationSession.insert("and then", " ");

      expect(textarea).toHaveValue("already here said so far and then");
    });

    it("hands the box's text to whatever replaces it in another frame, via clearDestination", () => {
      destinationSession.openNewFileField();
      destinationSession.insert("said so far", " ");

      expect(destinationSession.clearDestination()).toBe("said so far");
    });

    it("doesn't hand the text over twice once Open in new tab took it", () => {
      vi.spyOn(HTMLTextAreaElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(12, 400, 800, 200)); // jsdom does no layout
      destinationSession.openNewFileField();
      destinationSession.insert("said so far", " ");
      destinationSession.setIndicator({ state: "stopped" });

      within(document.documentElement).getByRole("button", { name: "Open in new tab" }).click();

      expect(destinationSession.clearDestination()).toBeNull();
      vi.restoreAllMocks();
    });

    it("gives up a page text box's text for a new box, leaving it in place", () => {
      textarea.value = "typed on the page";
      textarea.focus();
      destinationSession.pickFocused();

      expect(destinationSession.takeDestinationText()).toBe("typed on the page");
      expect(textarea).toHaveValue("typed on the page");
    });

    it("doesn't carry a box's text a second time once a new box in another frame took it", () => {
      destinationSession.openNewFileField();
      destinationSession.insert("said so far", " ");

      expect(destinationSession.takeDestinationText()).toBe("said so far");
      expect(destinationSession.clearDestination()).toBeNull();
    });

    it("keeps carrying a reused box's text after it is picked again", () => {
      destinationSession.openNewFileField();
      destinationSession.insert("said so far", " ");
      destinationSession.openNewFileField(destinationSession.takeDestinationText() ?? undefined);

      expect(newFileField()).toHaveValue("said so far");
      expect(destinationSession.clearDestination()).toBe("said so far");
    });

    it("closes the box when another text box becomes the output", () => {
      destinationSession.openNewFileField();

      destinationSession.startSelecting();
      textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      expect(newFileField()).toBeNull();
      expect(textarea.classList.contains("typetarget-destination")).toBe(true);
    });

    it("replaces a box left behind by an earlier injection", () => {
      const stale = document.createElement("textarea");
      stale.id = NEW_FILE_FIELD_ID;
      document.documentElement.append(stale);

      destinationSession.openNewFileField();

      expect(stale.isConnected).toBe(false);
      expect(document.querySelectorAll(`#${NEW_FILE_FIELD_ID}`)).toHaveLength(1);
    });
  });
});

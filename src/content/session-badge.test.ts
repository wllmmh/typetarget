import { afterEach, describe, expect, it, vi } from "vitest";
import { destinationSession } from "./destination-session";
import { within } from "@testing-library/react";
import { SESSION_BADGE_CONTROLS_ID, SESSION_BADGE_ID } from "./session-badge";
import { NEW_FILE_FIELD_ID } from "./new-file-field";

const badge = () => document.getElementById(SESSION_BADGE_ID);
const controls = () => document.getElementById(SESSION_BADGE_CONTROLS_ID);
/** The badge is attached to <html>, outside <body> where `screen` looks. */
const page = () => within(document.documentElement);

/** Picks a textarea laid out at (40, 100), since jsdom does no layout of its own. */
const pickTextarea = () => {
  const textarea = document.createElement("textarea");
  textarea.getBoundingClientRect = () => new DOMRect(40, 100, 200, 60);
  document.body.append(textarea);
  textarea.focus();
  destinationSession.pickFocused();
  return textarea;
};

/** Opens the "Type to new file" box, laid out (jsdom does no layout) so its buttons show. */
const openNewFile = () => {
  vi.spyOn(HTMLTextAreaElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(12, 400, 800, 200));
  destinationSession.openNewFileField();
};

/** jsdom's Blob has no text(). */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

afterEach(() => {
  destinationSession.clearDestination();
  destinationSession.onStopTypingRequested = null;
  destinationSession.onOpenInTabRequested = null;
  destinationSession.onMoveBackRequested = null;
  destinationSession.onMinimizeRequested = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session badge over the destination", () => {
  it("shows the elapsed listening time on the destination and keeps counting", () => {
    vi.useFakeTimers({ now: 100_000 });
    pickTextarea();

    destinationSession.setIndicator({ tabName: "Meeting", since: 100_000 - 65_000, state: "listening" });
    expect(badge()?.textContent).toBe("Meeting 1:05");
    expect(badge()?.style.left).toBe("40px");
    expect(badge()?.style.background).toBe("rgb(31, 157, 85)");
    expect(document.getElementById("typetarget-destination-style")?.textContent).toContain("#1f9d55");

    vi.advanceTimersByTime(2_000);
    expect(badge()?.textContent).toBe("Meeting 1:07");
  });

  it("sits with its bottom 1px inside the element's top edge and flush with its left edge (the outline is drawn inside the element)", () => {
    pickTextarea(); // laid out at (40, 100); jsdom badges have no height of their own

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    expect(badge()?.style.top).toBe("101px");
    expect(badge()?.style.left).toBe("40px");
  });

  it("shows a square and 0:00, with no tab name, in a red badge while a destination is picked but nothing is listening", () => {
    vi.useFakeTimers({ now: 50_000 });
    pickTextarea();

    destinationSession.setIndicator({ tabName: "Meeting", since: 50_000, state: "listening" });
    destinationSession.setIndicator({ state: "stopped" });
    vi.advanceTimersByTime(5_000);

    expect(badge()?.textContent).toBe("0:00");
    expect(badge()?.style.background).toBe("rgb(226, 39, 38)");
    expect(document.getElementById("typetarget-destination-style")?.textContent).toContain("#e22726");
  });

  it("shows a play triangle while listening, a cross while reconnecting, a square when stopped, and pause bars when paused", () => {
    pickTextarea();
    const icon = () => badge()?.querySelector("svg > *")?.outerHTML ?? null;

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });
    expect(icon()).toContain('d="M2 1.2 L10.5 6 L2 10.8 Z"');

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "reconnecting" });
    expect(icon()).toContain("M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5");

    destinationSession.setIndicator({ state: "stopped" });
    expect(icon()).toMatch(/^<rect/);

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "paused" });
    expect(icon()).toContain("M1.5 1 H4.5 V11 H1.5 Z");
    expect(badge()?.textContent).toBe("Meeting 0:00");
  });

  it("truncates a long tab name", () => {
    vi.useFakeTimers({ now: 10_000 });
    pickTextarea();

    destinationSession.setIndicator({ tabName: "A very long page title that goes on and on, and then some more", since: 10_000, state: "listening" });
    expect(badge()?.textContent).toBe("A very long page title that goes on and on, and… 0:00"); // 48 characters with the ellipsis
  });

  it("stays on the outline when the element moves without a scroll or resize (e.g. a chat box growing)", async () => {
    const textarea = pickTextarea();
    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });
    expect(badge()?.style.top).toBe("101px");

    textarea.getBoundingClientRect = () => new DOMRect(60, 40, 200, 120);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(badge()?.style.top).toBe("41px");
    expect(badge()?.style.left).toBe("60px");
  });

  it("shows only an icon, the tab name and the timer when reconnecting or paused", () => {
    vi.useFakeTimers({ now: 10_000 });
    pickTextarea();

    destinationSession.setIndicator({ tabName: "Meeting", since: 10_000, state: "reconnecting" });
    expect(badge()?.textContent).toBe("Meeting 0:00");

    destinationSession.setIndicator({ tabName: "Meeting", since: 10_000, state: "paused" });
    expect(badge()?.textContent).toBe("Meeting 0:00");
  });

  it("gives the destination's outline the badge's color, and restores it afterwards", () => {
    const textarea = pickTextarea();
    const outline = () => document.getElementById("typetarget-destination-style")?.textContent;
    expect(outline()).toContain("#e22726");

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "reconnecting" });
    expect(outline()).toContain("#6b7280");
    expect(badge()?.style.background).toBe("rgb(107, 114, 128)");

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "paused" });
    expect(outline()).toContain("#6b7280");

    destinationSession.setIndicator(null);
    expect(outline()).toContain("#e22726");
    expect(textarea.classList.contains("typetarget-destination")).toBe(true);
  });

  it("is removed when capture ends or the destination is deselected", () => {
    pickTextarea();
    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    destinationSession.setIndicator(null);
    expect(badge()).toBeNull();

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });
    destinationSession.clearDestination();
    expect(badge()).toBeNull();
  });

  it("attaches to the part of the element a clipping parent leaves visible", () => {
    const row = document.createElement("div");
    row.style.overflow = "hidden";
    row.getBoundingClientRect = () => new DOMRect(30, 106, 300, 60); // starts 6px below the textarea's own top
    document.body.append(row);
    const textarea = document.createElement("textarea");
    textarea.getBoundingClientRect = () => new DOMRect(40, 100, 200, 66);
    row.append(textarea);
    textarea.focus();
    destinationSession.pickFocused();

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    expect(badge()?.style.top).toBe("107px"); // 106 + 1, not 100 + 1
    expect(badge()?.style.left).toBe("40px"); // the textarea still starts right of the row's left edge
  });

  it("hides when a clipping parent leaves none of the element visible", () => {
    const row = document.createElement("div");
    row.style.overflow = "hidden";
    row.getBoundingClientRect = () => new DOMRect(30, 300, 300, 60);
    document.body.append(row);
    const textarea = document.createElement("textarea");
    textarea.getBoundingClientRect = () => new DOMRect(40, 100, 200, 66);
    row.append(textarea);
    textarea.focus();
    destinationSession.pickFocused();

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    expect(badge()?.style.display).toBe("none");
  });

  it("replaces a badge left behind by an earlier injection instead of adding a second one", () => {
    const stale = document.createElement("div");
    stale.id = SESSION_BADGE_ID;
    document.documentElement.append(stale);
    pickTextarea();

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    expect(document.querySelectorAll(`#${SESSION_BADGE_ID}`)).toHaveLength(1);
    expect(stale.isConnected).toBe(false);
    expect(document.querySelectorAll(`#${SESSION_BADGE_CONTROLS_ID}`)).toHaveLength(1);
  });

  it("puts the Save and X buttons on the outline's top right, in the badge's color", () => {
    pickTextarea(); // laid out at (40, 100), 200 wide

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    expect(page().getByRole("button", { name: "Save as .txt" })).toBeVisible();
    expect(page().getByRole("button", { name: "Stop typing here" })).toBeVisible();
    expect(controls()?.style.top).toBe("101px");
    expect(controls()?.style.left).toBe("240px"); // its right edge on the element's (jsdom gives it no width)
    expect(controls()?.style.background).toBe("rgb(31, 157, 85)");

    destinationSession.setIndicator({ state: "stopped" });
    expect(controls()?.style.background).toBe("rgb(226, 39, 38)");
  });

  it("asks to stop typing when X is clicked", () => {
    const onStopTypingRequested = vi.fn();
    destinationSession.onStopTypingRequested = onStopTypingRequested;
    pickTextarea();
    destinationSession.setIndicator({ state: "stopped" });

    page().getByRole("button", { name: "Stop typing here" }).click();

    expect(onStopTypingRequested).toHaveBeenCalledTimes(1);
  });

  it("downloads the destination's text as a .txt file when Save is clicked", async () => {
    const blobs: Blob[] = [];
    // jsdom has no blob URLs.
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = (blob: Blob) => {
        blobs.push(blob);
        return "blob:typetarget-test";
      };
      static revokeObjectURL = vi.fn();
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.download} ${this.href}`);
    });
    const textarea = pickTextarea();
    textarea.value = "Hello from the meeting";
    destinationSession.setIndicator({ state: "stopped" });

    page().getByRole("button", { name: "Save as .txt" }).click();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^typetarget-\d{4}-\d{2}-\d{2}-\d{4}\.txt blob:typetarget-test$/);
    expect(await Promise.all(blobs.map(readBlob))).toEqual(["Hello from the meeting"]);
  });

  it("offers Minimize and Open in new tab, between Save and X, on a page's box and the new-file box", () => {
    const buttonNames = () => within(controls() ?? document.body).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    pickTextarea();
    destinationSession.setIndicator({ state: "stopped" });
    expect(buttonNames()).toEqual(["Save as .txt", "Minimize", "Open in new tab", "Stop typing here"]);

    openNewFile();

    expect(buttonNames()).toEqual(["Save as .txt", "Minimize", "Open in new tab", "Stop typing here"]);
  });

  it("asks to move a page's box into a minimized new-file box, or a new tab with its text", () => {
    const onMinimizeRequested = vi.fn();
    const onOpenInTabRequested = vi.fn();
    destinationSession.onMinimizeRequested = onMinimizeRequested;
    destinationSession.onOpenInTabRequested = onOpenInTabRequested;
    const textarea = pickTextarea();
    textarea.value = "typed on the page";
    destinationSession.setIndicator({ state: "stopped" });

    page().getByRole("button", { name: "Minimize" }).click();
    page().getByRole("button", { name: "Open in new tab" }).click();

    expect(onMinimizeRequested).toHaveBeenCalledTimes(1);
    expect(onOpenInTabRequested).toHaveBeenCalledWith("typed on the page");
    expect(textarea).toHaveValue("typed on the page"); // the page keeps its text
  });

  it("minimizes the new-file box to one line and restores it", () => {
    openNewFile();
    destinationSession.setIndicator({ state: "stopped" });
    const field = document.getElementById(NEW_FILE_FIELD_ID);

    page().getByRole("button", { name: "Minimize" }).click();
    expect(field?.style.height).toBe("46.5px"); // one 15px line at 1.5 line-height, plus 12px padding above and below
    expect(page().queryByRole("button", { name: "Minimize" })).toBeNull();

    page().getByRole("button", { name: "Restore" }).click();
    expect(field?.style.height).toMatch(/33\.33/);
    expect(page().getByRole("button", { name: "Minimize" })).toBeVisible();
  });

  it("restores a minimized new-file box when Type to new file is chosen again", () => {
    openNewFile();
    destinationSession.setIndicator({ state: "stopped" });
    page().getByRole("button", { name: "Minimize" }).click();

    openNewFile();

    expect(document.getElementById(NEW_FILE_FIELD_ID)?.style.height).toMatch(/33\.33/);
    expect(page().getByRole("button", { name: "Minimize" })).toBeVisible();
  });

  it("hands the new-file box's text over when Open in new tab is clicked", () => {
    const onOpenInTabRequested = vi.fn();
    destinationSession.onOpenInTabRequested = onOpenInTabRequested;
    openNewFile();
    destinationSession.insert("Hello from the meeting", " ");
    destinationSession.setIndicator({ state: "stopped" });

    page().getByRole("button", { name: "Open in new tab" }).click();

    expect(onOpenInTabRequested).toHaveBeenCalledWith("Hello from the meeting");
  });

  it("offers Move back to page in the editor tab, handing over the box's text", () => {
    const onMoveBackRequested = vi.fn();
    destinationSession.onMoveBackRequested = onMoveBackRequested;
    const textarea = pickTextarea();
    textarea.value = "Hello from the meeting";
    destinationSession.setIndicator({ state: "stopped" });

    const names = within(controls() ?? document.body).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["Save as .txt", "Move back to page", "Stop typing here"]); // already a tab: no Minimize or Open in new tab
    page().getByRole("button", { name: "Move back to page" }).click();

    expect(onMoveBackRequested).toHaveBeenCalledWith("Hello from the meeting");
  });

  it("hides the buttons with the badge when none of the element is visible", () => {
    const textarea = pickTextarea();
    destinationSession.setIndicator({ state: "stopped" });

    textarea.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    expect(controls()?.style.display).toBe("none");
    expect(page().queryByRole("button", { name: "Save as .txt" })).toBeNull();
  });

  it("removes the buttons with the badge", () => {
    pickTextarea();
    destinationSession.setIndicator({ state: "stopped" });

    destinationSession.clearDestination();

    expect(controls()).toBeNull();
  });

  it("shows nothing when no destination is picked in this frame", () => {
    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });
    expect(badge()).toBeNull();
  });
});

describe("a new-file box kept after Stop typing", () => {
  it("stays on the page with its text, marked as no longer typed into", () => {
    openNewFile();
    destinationSession.insert("said so far", " ");

    expect(destinationSession.clearDestination(true)).toBeNull();

    expect(document.getElementById(NEW_FILE_FIELD_ID)).toHaveValue("said so far");
    expect(badge()).toHaveTextContent("Not typing");
    expect(destinationSession.insert("more", " ")).toBe(false);
  });

  it("keeps its outline, in the grey of its buttons", () => {
    openNewFile();
    destinationSession.clearDestination(true);
    destinationSession.setIndicator(null); // the background removing the session badge must not take the outline

    expect(document.getElementById(NEW_FILE_FIELD_ID)?.classList.contains("typetarget-destination")).toBe(true);
    expect(document.getElementById("typetarget-destination-style")?.textContent).toContain("4px double #6b7280");
    expect(controls()?.style.background).toBe(badge()?.style.background);
  });

  it("keeps its X when the background then removes the session badge", () => {
    openNewFile();
    destinationSession.clearDestination(true);

    destinationSession.setIndicator(null);

    expect(page().getByRole("button", { name: "Close" })).toBeVisible();
  });

  it("is removed by its X, without involving the background", () => {
    const onStopTypingRequested = vi.fn();
    destinationSession.onStopTypingRequested = onStopTypingRequested;
    openNewFile();
    destinationSession.clearDestination(true);

    page().getByRole("button", { name: "Close" }).click();

    expect(document.getElementById(NEW_FILE_FIELD_ID)).toBeNull();
    expect(badge()).toBeNull();
    expect(document.getElementById("typetarget-destination-style")).toBeNull();
    expect(onStopTypingRequested).not.toHaveBeenCalled();
  });

  it("becomes the output again, text and all, when Type to new file is chosen", () => {
    openNewFile();
    destinationSession.insert("said so far", " ");
    destinationSession.clearDestination(true);

    destinationSession.openNewFileField();
    destinationSession.setIndicator({ state: "stopped" }); // what the background sends once it hears of the pick
    destinationSession.insert("and then", " ");

    expect(document.getElementById(NEW_FILE_FIELD_ID)).toHaveValue("said so far and then");
    expect(page().getByRole("button", { name: "Stop typing here" })).toBeVisible();
  });
});

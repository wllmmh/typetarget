import { afterEach, describe, expect, it, vi } from "vitest";
import { destinationSession } from "./destination-session";
import { SESSION_BADGE_ID } from "./session-badge";

const badge = () => document.getElementById(SESSION_BADGE_ID);

/** Picks a textarea laid out at (40, 100), since jsdom does no layout of its own. */
const pickTextarea = () => {
  const textarea = document.createElement("textarea");
  textarea.getBoundingClientRect = () => new DOMRect(40, 100, 200, 60);
  document.body.append(textarea);
  textarea.focus();
  destinationSession.pickFocused();
  return textarea;
};

afterEach(() => {
  destinationSession.clearDestination();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("session badge over the destination", () => {
  it("shows the elapsed listening time on the destination and keeps counting", () => {
    vi.useFakeTimers({ now: 100_000 });
    pickTextarea();

    destinationSession.setIndicator({ tabName: "Meeting", since: 100_000 - 65_000, state: "listening" });
    expect(badge()?.textContent).toBe("Meeting 1:05");
    expect(badge()?.style.left).toBe("38px");
    expect(badge()?.style.background).toBe("rgb(31, 157, 85)");
    expect(document.getElementById("typetarget-destination-style")?.textContent).toContain("#1f9d55");

    vi.advanceTimersByTime(2_000);
    expect(badge()?.textContent).toBe("Meeting 1:07");
  });

  it("sits above the outline, 1px up and 2px left of the element's corner", () => {
    pickTextarea(); // laid out at (40, 100); jsdom badges have no height of their own

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });

    expect(badge()?.style.top).toBe("99px");
    expect(badge()?.style.left).toBe("38px");
  });

  it("shows a square and 0:00 in a red badge while a destination is picked but nothing is listening", () => {
    vi.useFakeTimers({ now: 50_000 });
    pickTextarea();

    destinationSession.setIndicator({ tabName: "Meeting", state: "stopped" });
    vi.advanceTimersByTime(5_000);

    expect(badge()?.textContent).toBe("Meeting 0:00");
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

    destinationSession.setIndicator({ tabName: "Meeting", state: "stopped" });
    expect(icon()).toMatch(/^<rect/);

    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "paused" });
    expect(icon()).toContain("M1.5 1 H4.5 V11 H1.5 Z");
    expect(badge()?.textContent).toBe("Meeting 0:00");
  });

  it("truncates a long tab name, and shows what it is told when no tab is selected", () => {
    pickTextarea();

    destinationSession.setIndicator({ tabName: "A very long page title that goes on and on", state: "stopped" });
    expect(badge()?.textContent).toBe("A very long page title that… 0:00");

    destinationSession.setIndicator({ tabName: "No Tab Selected", state: "stopped" });
    expect(badge()?.textContent).toBe("No Tab Selected 0:00");
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

  it("shows nothing when no destination is picked in this frame", () => {
    destinationSession.setIndicator({ tabName: "Meeting", since: Date.now(), state: "listening" });
    expect(badge()).toBeNull();
  });
});

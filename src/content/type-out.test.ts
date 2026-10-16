import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TYPING_DURATION_MS, typeOut } from "./type-out";

describe("typeOut", () => {
  let written: string[];
  const write = (slice: string) => written.push(slice);

  beforeEach(() => {
    written = [];
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes the text a slice per frame, in order, all of it within the typing duration", () => {
    typeOut("Hello from the meeting", write);
    expect(written).toEqual([]);

    vi.advanceTimersByTime(TYPING_DURATION_MS / 2);
    const halfway = written.join("");
    expect(halfway.length).toBeGreaterThan(0);
    expect("Hello from the meeting".startsWith(halfway)).toBe(true);
    expect(halfway).not.toBe("Hello from the meeting");

    vi.advanceTimersByTime(TYPING_DURATION_MS / 2);
    expect(written.join("")).toBe("Hello from the meeting");
    expect(written.length).toBeGreaterThan(2);
  });

  it("types a long text out in the same time as a short one", () => {
    const long = "word ".repeat(2000);

    typeOut(long, write);
    vi.advanceTimersByTime(TYPING_DURATION_MS);

    expect(written.join("")).toBe(long);
    expect(written.length).toBeLessThanOrEqual(Math.ceil(TYPING_DURATION_MS / 16) + 1);
  });

  it("writes the rest at once on finish, and nothing after", () => {
    const typing = typeOut("Hello from the meeting", write);
    vi.advanceTimersByTime(TYPING_DURATION_MS / 4);

    typing.finish();
    expect(written.join("")).toBe("Hello from the meeting");

    const count = written.length;
    vi.advanceTimersByTime(TYPING_DURATION_MS);
    typing.finish();
    expect(written).toHaveLength(count);
  });

  it("writes everything at once in a hidden tab, which draws no frames", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    typeOut("Hello from the meeting", write);

    expect(written).toEqual(["Hello from the meeting"]);
  });

  it("writes the rest at once when the tab is hidden mid-way", () => {
    typeOut("Hello from the meeting", write);
    vi.advanceTimersByTime(TYPING_DURATION_MS / 4);

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(written.join("")).toBe("Hello from the meeting");
  });

  it("writes everything at once when the user asks for reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));

    typeOut("Hello from the meeting", write);

    expect(written).toEqual(["Hello from the meeting"]);
    vi.unstubAllGlobals();
  });
});

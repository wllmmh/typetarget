import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_999)).toBe("0:09");
    expect(formatElapsed(10 * 60_000 + 5_000)).toBe("10:05");
  });

  it("adds hours from an hour on", () => {
    expect(formatElapsed(3_600_000 + 2 * 60_000 + 3_000)).toBe("1:02:03");
  });

  it("clamps a negative duration (clock skew between contexts) to zero", () => {
    expect(formatElapsed(-500)).toBe("0:00");
  });
});

import { describe, expect, it } from "vitest";
import { isUserEvent } from "./user-event";

describe("isUserEvent", () => {
  it("rejects an event a script dispatched", () => {
    const button = document.createElement("button");
    let seen: Event | null = null;
    button.addEventListener("click", (e) => (seen = e));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.click();

    expect(seen).not.toBeNull();
    expect(isUserEvent(new MouseEvent("click"))).toBe(false);
    expect(isUserEvent(seen as unknown as Event)).toBe(false);
  });
});

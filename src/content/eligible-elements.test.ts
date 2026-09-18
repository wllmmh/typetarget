import { describe, expect, it } from "vitest";
import { isEligibleDestination, findEligibleAncestor } from "./eligible-elements";

describe("isEligibleDestination", () => {
  it("accepts a plain textarea", () => {
    expect(isEligibleDestination(document.createElement("textarea"))).toBe(true);
  });

  it("rejects a disabled or readonly textarea", () => {
    const disabled = document.createElement("textarea");
    disabled.disabled = true;
    expect(isEligibleDestination(disabled)).toBe(false);

    const readonly = document.createElement("textarea");
    readonly.readOnly = true;
    expect(isEligibleDestination(readonly)).toBe(false);
  });

  it("accepts text-like input types and rejects others", () => {
    const text = document.createElement("input");
    text.type = "text";
    expect(isEligibleDestination(text)).toBe(true);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isEligibleDestination(checkbox)).toBe(false);

    const file = document.createElement("input");
    file.type = "file";
    expect(isEligibleDestination(file)).toBe(false);
  });

  it("accepts contenteditable elements", () => {
    const div = document.createElement("div");
    // jsdom doesn't implement the contentEditable *property* (setting it is a
    // no-op there, unlike real Chrome) or isContentEditable, so tests set the
    // attribute directly; production code's isContentEditableElement() falls back
    // to reading this same attribute when isContentEditable isn't a boolean.
    div.setAttribute("contenteditable", "true");
    expect(isEligibleDestination(div)).toBe(true);
  });

  it("rejects plain non-editable elements", () => {
    expect(isEligibleDestination(document.createElement("div"))).toBe(false);
    expect(isEligibleDestination(document.createElement("p"))).toBe(false);
  });
});

describe("findEligibleAncestor", () => {
  it("returns the element itself when eligible", () => {
    const textarea = document.createElement("textarea");
    expect(findEligibleAncestor(textarea)).toBe(textarea);
  });

  it("walks up to find an eligible ancestor", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    const span = document.createElement("span");
    div.append(span);

    expect(findEligibleAncestor(span)).toBe(div);
  });

  it("returns null when nothing eligible is found", () => {
    const div = document.createElement("div");
    const span = document.createElement("span");
    div.append(span);
    expect(findEligibleAncestor(span)).toBeNull();
  });

  it("returns null for non-Element targets", () => {
    expect(findEligibleAncestor(null)).toBeNull();
    expect(findEligibleAncestor(window)).toBeNull();
  });
});

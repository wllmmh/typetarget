import { describe, expect, it, vi } from "vitest";
import { insertTranscriptText, toInsertionTarget, type InsertionTarget } from "./insert-text";

describe("insertTranscriptText — text fields", () => {
  it("inserts at offset 0 with no separator", () => {
    const textarea = document.createElement("textarea");
    const target: InsertionTarget = { kind: "text-field", element: textarea };

    const newOffset = insertTranscriptText(target, "hello", " ", 0);

    expect(textarea.value).toBe("hello");
    expect(newOffset).toBe(5);
  });

  it("appends with a separator when inserting after existing content", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "Meeting notes:";
    const target: InsertionTarget = { kind: "text-field", element: textarea };

    const offset = insertTranscriptText(target, "We should move the launch to Friday.", "\n\n", textarea.value.length);

    expect(textarea.value).toBe("Meeting notes:\n\nWe should move the launch to Friday.");
    expect(offset).toBe(textarea.value.length);
  });

  it("preserves text the user typed after the insertion boundary", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "before|after"; // pretend the boundary is right after "before"
    const target: InsertionTarget = { kind: "text-field", element: textarea };

    insertTranscriptText(target, "MID", "", "before".length);

    expect(textarea.value).toBe("beforeMID|after");
  });

  it("dispatches input and change events", () => {
    const textarea = document.createElement("textarea");
    const onInput = vi.fn();
    const onChange = vi.fn();
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("change", onChange);
    const target: InsertionTarget = { kind: "text-field", element: textarea };

    insertTranscriptText(target, "hi", " ", 0);

    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("writes through the native prototype setter rather than the instance's own value setter", () => {
    // React patches the *instance* property with its own setter/getter so it can
    // intercept plain `el.value = x` assignment (its "tracked value" mechanism).
    // insert-text.ts is written to call the *prototype's* setter directly
    // (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set)
    // specifically to defeat that interception — this asserts the instance setter
    // is never invoked, i.e. the code takes the bypass path rather than plain
    // `el.value = x`. (jsdom's own internal value storage isn't routed through this
    // instance property the way a real browser's is, so asserting the final `.value`
    // here wouldn't actually exercise the interception scenario — see insertion
    // tests above for value-correctness coverage.)
    const input = document.createElement("input");
    input.type = "text";
    const instanceSetter = vi.fn();
    Object.defineProperty(input, "value", {
      get: () => "",
      set: instanceSetter,
      configurable: true,
    });

    const target: InsertionTarget = { kind: "text-field", element: input };
    insertTranscriptText(target, "hello", "", 0);

    expect(instanceSetter).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range offset to the current value length", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "abc";
    const target: InsertionTarget = { kind: "text-field", element: textarea };

    const offset = insertTranscriptText(target, "X", "", 999);

    expect(textarea.value).toBe("abcX");
    expect(offset).toBe(4);
  });
});

describe("insertTranscriptText — contenteditable", () => {
  it("appends text at the end of existing content without disturbing it", () => {
    const div = document.createElement("div");
    document.body.append(div); // Selection/Range APIs need the element connected to the document
    div.textContent = "existing";
    const target: InsertionTarget = { kind: "content-editable", element: div };

    insertTranscriptText(target, "new text", " ", div.textContent.length);

    expect(div.textContent).toBe("existing new text");
    div.remove();
  });

  it("dispatches an input event", () => {
    const div = document.createElement("div");
    document.body.append(div); // Selection/Range APIs need the element connected to the document
    const onInput = vi.fn();
    div.addEventListener("input", onInput);
    const target: InsertionTarget = { kind: "content-editable", element: div };

    insertTranscriptText(target, "hi", "", 0);

    expect(onInput).toHaveBeenCalledTimes(1);
    div.remove();
  });
});

describe("toInsertionTarget", () => {
  it("maps textarea/input to text-field", () => {
    expect(toInsertionTarget(document.createElement("textarea"))?.kind).toBe("text-field");
    expect(toInsertionTarget(document.createElement("input"))?.kind).toBe("text-field");
  });

  it("maps contenteditable to content-editable", () => {
    const div = document.createElement("div");
    // See eligible-elements.test.ts: jsdom doesn't implement the contentEditable
    // property, so the attribute is set directly.
    div.setAttribute("contenteditable", "true");
    expect(toInsertionTarget(div)?.kind).toBe("content-editable");
  });

  it("returns null for an ineligible element", () => {
    expect(toInsertionTarget(document.createElement("div"))).toBeNull();
  });
});

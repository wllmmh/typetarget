import { describe, expect, it } from "vitest";
import { textFileName, textOf } from "./save-text-file";

describe("textFileName", () => {
  it("names the file after the local date and time, zero-padded", () => {
    expect(textFileName(new Date(2026, 0, 5, 9, 7))).toBe("typetarget-2026-01-05-0907.txt");
  });
});

describe("textOf", () => {
  it("reads a text field's value and a rich editor's text", () => {
    const input = document.createElement("input");
    input.value = "typed";
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.textContent = "rich";

    expect(textOf(input)).toBe("typed");
    expect(textOf(editor)).toBe("rich");
  });
});

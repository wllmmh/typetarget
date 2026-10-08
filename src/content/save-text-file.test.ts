import { describe, expect, it } from "vitest";
import { textFileName, textOf } from "./save-text-file";

describe("textFileName", () => {
  it("names the file after the local date and time, zero-padded", () => {
    expect(textFileName(new Date(2026, 0, 5, 9, 7, 3))).toBe("TypeTarget-2026-01-05T09-07-03.txt");
  });

  it("includes the source tab's title, without characters a file name can't hold", () => {
    expect(textFileName(new Date(2026, 0, 5, 9, 7, 3), "Talk: A/B  Testing?")).toBe("TypeTarget-Talk_A_B_Testing-2026-01-05T09-07-03.txt");
  });

  it("caps a long title and leaves out one with nothing usable", () => {
    expect(textFileName(new Date(2026, 0, 5, 9, 7, 3), "x".repeat(80))).toBe(`TypeTarget-${"x".repeat(50)}-2026-01-05T09-07-03.txt`);
    expect(textFileName(new Date(2026, 0, 5, 9, 7, 3), "?/")).toBe("TypeTarget-2026-01-05T09-07-03.txt");
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

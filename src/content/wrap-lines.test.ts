import { describe, expect, it } from "vitest";
import { MAX_LINE_LENGTH, columnAt, wrapLines } from "./wrap-lines";

const lineLengths = (text: string) => text.split("\n").map((line) => line.length);

describe("wrapLines", () => {
  it("leaves text that fits on the line alone", () => {
    expect(wrapLines(" and then we moved on", 20)).toBe(" and then we moved on");
  });

  it("keeps every line within the limit, breaking only between words", () => {
    const words = "the quarterly numbers came in under the forecast so we are revisiting the plan".split(" ");
    const text = Array.from({ length: 20 }, () => words.join(" ")).join(" ");

    const wrapped = wrapLines(text, 0);

    expect(Math.max(...lineLengths(wrapped))).toBeLessThanOrEqual(MAX_LINE_LENGTH);
    expect(wrapped.replaceAll("\n", " ")).toBe(text);
  });

  it("ends a long enough line at a sentence end rather than mid-sentence", () => {
    const sentence = "We looked at the numbers from last quarter and they were fine."; // 62 characters
    expect(wrapLines(`${sentence} Next item.`, 0)).toBe(`${sentence}\nNext item.`);
  });

  it("doesn't break after a sentence on a short line", () => {
    expect(wrapLines("Okay. Next item.", 0)).toBe("Okay. Next item.");
  });

  it("counts what is already on the line, and breaks at the separator when the text won't fit after it", () => {
    expect(wrapLines(" hello there", 75)).toBe("\nhello there");
  });

  it("leaves a word longer than a line whole", () => {
    const long = "x".repeat(MAX_LINE_LENGTH + 10);
    expect(wrapLines(`a ${long} b`, 0)).toBe(`a\n${long}\nb`);
  });

  it("keeps the text's length, so slices of it line up with the original", () => {
    const text = " ".concat("word ".repeat(100).trim());
    expect(wrapLines(text, 50)).toHaveLength(text.length);
  });
});

describe("columnAt", () => {
  it("counts the characters since the last line break", () => {
    expect(columnAt("first line\nsecond", 17)).toBe(6);
    expect(columnAt("no break", 8)).toBe(8);
    expect(columnAt("ends with break\n", 16)).toBe(0);
  });
});

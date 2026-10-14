import { describe, expect, it } from "vitest";
import { isSpokenLanguage, SPOKEN_LANGUAGE_NAMES, SPOKEN_LANGUAGES } from "./languages";

describe("SPOKEN_LANGUAGES", () => {
  it("lists Whisper's languages that have an ISO 639-1 code, once each", () => {
    expect(SPOKEN_LANGUAGES).toHaveLength(97);
    expect(new Set(SPOKEN_LANGUAGES).size).toBe(SPOKEN_LANGUAGES.length);
    for (const code of SPOKEN_LANGUAGES) expect(code).toMatch(/^[a-z]{2}$/);
  });
});

describe("SPOKEN_LANGUAGE_NAMES", () => {
  it("names each language in itself, not in the UI's language", () => {
    expect(SPOKEN_LANGUAGE_NAMES).toMatchObject({ en: "English", vi: "Tiếng Việt", fr: "Français", pl: "Polski", ja: "日本語" });
  });

  it("gives every language a distinct name", () => {
    const names = Object.values(SPOKEN_LANGUAGE_NAMES);
    expect(names).toHaveLength(SPOKEN_LANGUAGES.length);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("isSpokenLanguage", () => {
  it("accepts only listed codes", () => {
    expect(isSpokenLanguage("fr")).toBe(true);
    expect(isSpokenLanguage("jw")).toBe(false);
    expect(isSpokenLanguage("FR")).toBe(false);
    expect(isSpokenLanguage(null)).toBe(false);
  });
});

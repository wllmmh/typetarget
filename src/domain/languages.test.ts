import { describe, expect, it } from "vitest";
import { isSpokenLanguage, SPOKEN_LANGUAGE_NAMES, SPOKEN_LANGUAGES, spokenLanguageOptions } from "./languages";

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

describe("spokenLanguageOptions", () => {
  const optionFor = (locale: string, code: string) => spokenLanguageOptions(locale).find((option) => option.code === code);

  it("names each language in the UI's language, then in its own", () => {
    expect(optionFor("en", "es")).toEqual({ code: "es", name: "Spanish", endonym: "Español" });
    expect(optionFor("ja", "vi")).toEqual({ code: "vi", name: "ベトナム語", endonym: "Tiếng Việt" });
  });

  it("capitalizes the UI-language name for a menu", () => {
    expect(optionFor("fr", "es")).toMatchObject({ name: "Espagnol", endonym: "Español" });
    expect(optionFor("tr", "es")?.name).toBe("İspanyolca");
  });

  it("names the UI's own language once", () => {
    expect(optionFor("en", "en")).toEqual({ code: "en", name: "English", endonym: null });
    expect(optionFor("es", "es")).toEqual({ code: "es", name: "Español", endonym: null });
  });

  it("lists every language once, in the UI language's order of the first name", () => {
    for (const locale of ["en", "de", "ja", "ar"]) {
      const options = spokenLanguageOptions(locale);
      expect(options.map(({ code }) => code).sort()).toEqual([...SPOKEN_LANGUAGES]);
      const names = options.map(({ name }) => name);
      expect(names).toEqual([...names].sort(new Intl.Collator(locale).compare));
    }
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

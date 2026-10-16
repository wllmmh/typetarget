import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";

type CatalogEntry = { message: string; placeholders?: Record<string, { content: string }> };

const localesDir = path.resolve(__dirname, "../../_locales");
const readCatalog = (locale: string): Record<string, CatalogEntry> =>
  JSON.parse(readFileSync(path.join(localesDir, locale, "messages.json"), "utf8"));

const english = readCatalog("en");
const locales = readdirSync(localesDir);

/** The `$NAME$` placeholders a message uses, lower-cased as Chrome matches them. */
const usedPlaceholders = (message: string): string[] =>
  [...new Set([...message.matchAll(/\$([a-z0-9_]+)\$/gi)].map(([, name]) => (name ?? "").toLowerCase()))].sort();

describe("t", () => {
  it("fills a message's placeholders in order", () => {
    expect(t("statusDownloadingPercent", 40, 12, 31)).toBe("Downloading model 40% (12/31 MB)");
  });

  // The display language, not the preferred languages for pages: chrome.i18n picks the locale.
  it("asks chrome.i18n, which follows the browser's display language", () => {
    t("apiKeyTitle", "Groq");
    expect(chrome.i18n.getMessage).toHaveBeenCalledWith("apiKeyTitle", ["Groq"]);
  });
});

describe.each(locales)("_locales/%s", (locale) => {
  const catalog = readCatalog(locale);

  // Chrome shows English for a missing message without any warning, so a gap would go unnoticed.
  it("has exactly the English messages", () => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
  });

  it("uses each message's placeholders, with the same substitutions as English", () => {
    const substitutions = (entry: CatalogEntry | undefined) =>
      Object.fromEntries(Object.entries(entry?.placeholders ?? {}).map(([name, { content }]) => [name, content]));
    for (const [key, entry] of Object.entries(catalog)) {
      expect(usedPlaceholders(entry.message), key).toEqual(Object.keys(entry.placeholders ?? {}).sort());
      expect(substitutions(entry), key).toEqual(substitutions(english[key]));
    }
  });

  // Lays out the popup and editor tab (dir), so it must be a value dir accepts.
  it("says which way the language is written", () => {
    expect(["ltr", "rtl"]).toContain(catalog.textDirection?.message);
  });

  // Names the spoken languages (domain/languages.ts), so it must be this file's own locale.
  it("gives its locale as a BCP 47 tag", () => {
    const tag = locale.replace("_", "-");
    expect(catalog.locale?.message).toBe(tag);
    expect(Intl.DisplayNames.supportedLocalesOf(tag)).toEqual([tag]);
  });

  // Chrome's limits for the manifest's name and description.
  it("keeps the name and description within Chrome's limits", () => {
    expect(catalog.extName?.message.length).toBeLessThanOrEqual(75);
    expect(catalog.extDescription?.message.length).toBeLessThanOrEqual(132);
  });
});

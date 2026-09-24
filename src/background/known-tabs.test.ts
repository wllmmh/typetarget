import { describe, expect, it } from "vitest";
import type { CapturableTab } from "../domain/messages";
import { parseKnownTabs, pruneKnownTabs, recordKnownTab, removeKnownTab } from "./known-tabs";

const tab = (id: number, url: string, title?: string): chrome.tabs.Tab =>
  ({ id, url, title }) as chrome.tabs.Tab;

describe("recordKnownTab", () => {
  it("records a web tab with its title", () => {
    expect(recordKnownTab([], tab(1, "https://youtube.com/watch", "JFK speech - YouTube"))).toEqual([
      { tabId: 1, title: "JFK speech - YouTube", url: "https://youtube.com/watch", favIconUrl: undefined },
    ]);
  });

  it("moves a tab already known to the front instead of duplicating it", () => {
    const known = recordKnownTab(recordKnownTab([], tab(1, "https://a.test", "A")), tab(2, "https://b.test", "B"));

    const result = recordKnownTab(known, tab(1, "https://a.test", "A"));

    expect(result.map((t) => t.tabId)).toEqual([1, 2]);
  });

  it("ignores tabs whose url or title activeTab never granted us", () => {
    expect(recordKnownTab([], tab(1, undefined as unknown as string))).toEqual([]);
    expect(recordKnownTab([], { url: "https://a.test" } as chrome.tabs.Tab)).toEqual([]);
  });

  it("ignores non-web tabs, including the extension's own pages", () => {
    expect(recordKnownTab([], tab(1, "chrome-extension://abc/src/popup/index.html", "TypeTarget"))).toEqual([]);
    expect(recordKnownTab([], tab(2, "chrome://settings", "Settings"))).toEqual([]);
  });

  it("falls back to the url when a tab has no usable title", () => {
    expect(recordKnownTab([], tab(1, "https://a.test", "   "))[0]?.title).toBe("https://a.test");
  });

  it("keeps only the ten most recent tabs", () => {
    let known: CapturableTab[] = [];
    for (let i = 1; i <= 12; i++) known = recordKnownTab(known, tab(i, `https://${i}.test`, `T${i}`));

    expect(known).toHaveLength(10);
    expect(known[0]?.tabId).toBe(12);
    expect(known.some((t) => t.tabId === 1)).toBe(false);
  });
});

describe("removeKnownTab / pruneKnownTabs", () => {
  const known = [
    { tabId: 1, title: "A", url: "https://a.test" },
    { tabId: 2, title: "B", url: "https://b.test" },
  ];

  it("removes a closed tab", () => {
    expect(removeKnownTab(known, 1).map((t) => t.tabId)).toEqual([2]);
  });

  it("drops tabs that are no longer open", () => {
    expect(pruneKnownTabs(known, [2, 99]).map((t) => t.tabId)).toEqual([2]);
  });
});

describe("parseKnownTabs", () => {
  it("keeps well-formed entries and discards anything else", () => {
    const parsed = parseKnownTabs([
      { tabId: 1, title: "A", url: "https://a.test", favIconUrl: "https://a.test/i.png" },
      { tabId: "2", title: "B", url: "https://b.test" },
      null,
      { tabId: 3 },
    ]);

    expect(parsed).toEqual([{ tabId: 1, title: "A", url: "https://a.test", favIconUrl: "https://a.test/i.png" }]);
  });

  it("returns an empty list for a non-array", () => {
    expect(parseKnownTabs("nope")).toEqual([]);
  });
});

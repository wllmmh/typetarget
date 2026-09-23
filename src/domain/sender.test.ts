import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome } from "../test/fake-chrome";
import { isFromExtensionPage, isFromServiceWorker } from "./sender";

const ORIGIN = "chrome-extension://abc";

beforeEach(() => {
  const fake = installFakeChrome();
  fake.runtime.id = "abc";
  fake.runtime.getURL.mockImplementation((path: string) => `${ORIGIN}/${path}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isFromExtensionPage", () => {
  it("accepts this extension's page at the given path", () => {
    expect(isFromExtensionPage({ id: "abc", url: `${ORIGIN}/src/offscreen/index.html` }, "src/offscreen/index.html")).toBe(true);
  });

  it("rejects another page of this extension", () => {
    expect(isFromExtensionPage({ id: "abc", url: `${ORIGIN}/src/popup/index.html` }, "src/offscreen/index.html")).toBe(false);
  });

  it("rejects another extension claiming the same path", () => {
    expect(isFromExtensionPage({ id: "evil", url: `${ORIGIN}/src/offscreen/index.html` }, "src/offscreen/index.html")).toBe(false);
  });

  it("rejects a web page or content script (which carry a web url)", () => {
    expect(isFromExtensionPage({ id: "abc", url: "https://example.com/" }, "src/offscreen/index.html")).toBe(false);
  });
});

describe("isFromServiceWorker", () => {
  it("accepts the extension's service worker script", () => {
    expect(isFromServiceWorker({ id: "abc", url: `${ORIGIN}/service-worker-loader.js` })).toBe(true);
  });

  it("rejects the popup and the offscreen document, whose message kinds overlap with the service worker's", () => {
    expect(isFromServiceWorker({ id: "abc", url: `${ORIGIN}/src/popup/index.html` })).toBe(false);
    expect(isFromServiceWorker({ id: "abc", url: `${ORIGIN}/src/offscreen/index.html` })).toBe(false);
  });

  it("rejects a content script (it carries a tab and a web url)", () => {
    expect(isFromServiceWorker({ id: "abc", url: "https://example.com/app.js", tab: { id: 1 } as chrome.tabs.Tab })).toBe(false);
  });

  it("rejects another extension", () => {
    expect(isFromServiceWorker({ id: "evil", url: `${ORIGIN}/service-worker-loader.js` })).toBe(false);
  });
});

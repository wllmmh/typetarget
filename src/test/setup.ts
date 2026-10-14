import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto"; // jsdom doesn't implement IndexedDB; see model-cache.test.ts
import { createFakeI18n } from "./fake-chrome";

// UI text comes from chrome.i18n (domain/i18n.ts), even in modules whose tests install no fake
// chrome of their own. Assigned rather than stubbed, so vi.unstubAllGlobals() restores it.
Object.assign(globalThis, { chrome: { i18n: createFakeI18n() } });

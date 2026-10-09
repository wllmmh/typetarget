import { vi } from "vitest";

/**
 * Minimal fake of the subset of the `chrome.*` extension API this codebase touches.
 * jsdom doesn't provide `chrome`, and pulling in a full mocking library for a handful
 * of callback/event APIs would be more machinery than the surface warrants (see
 * AGENTS.md "No new dependency if ... ~20 lines of local code covers it").
 * Each test installs this on `globalThis.chrome` and resets between runs.
 */
/** A chrome.events.Event whose listeners the test can fire. */
export type FakeEvent<Args extends unknown[]> = {
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  hasListener: ReturnType<typeof vi.fn>;
  /** Test helper: fires the registered listener(s) as Chrome would. */
  emit: (...args: Args) => void;
};

export type FakeChrome = {
  tabs: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    onRemoved: FakeEvent<[tabId: number]>;
    onUpdated: FakeEvent<[tabId: number, change: chrome.tabs.TabChangeInfo]>;
    onActivated: FakeEvent<[info: { tabId: number; windowId: number }]>;
  };
  windows: {
    update: ReturnType<typeof vi.fn>;
    onFocusChanged: FakeEvent<[windowId: number]>;
    WINDOW_ID_NONE: -1;
  };
  contextMenus: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    removeAll: ReturnType<typeof vi.fn>;
    onClicked: FakeEvent<[info: Partial<chrome.contextMenus.OnClickData>, tab?: Partial<chrome.tabs.Tab>]>;
  };
  action: {
    setBadgeText: ReturnType<typeof vi.fn>;
    setBadgeBackgroundColor: ReturnType<typeof vi.fn>;
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: FakeEvent<[message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void]>;
    lastError: { message: string } | undefined;
    id: string;
    getURL: ReturnType<typeof vi.fn>;
    getContexts: ReturnType<typeof vi.fn>;
    ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" };
  };
  offscreen: {
    createDocument: ReturnType<typeof vi.fn>;
    closeDocument: ReturnType<typeof vi.fn>;
    Reason: { USER_MEDIA: "USER_MEDIA" };
  };
  tabCapture: {
    getMediaStreamId: ReturnType<typeof vi.fn>;
  };
  storage: {
    local: FakeStorageArea;
    session: FakeStorageArea;
  };
};

export type FakeStorageArea = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setAccessLevel: ReturnType<typeof vi.fn>;
  /** Test helper: the area's current contents. */
  data: Record<string, unknown>;
};

/** In-memory stand-in for one chrome.storage area (jsdom has no chrome.storage at all). */
const createFakeStorageArea = (): FakeStorageArea => {
  const area: FakeStorageArea = {
    data: {},
    get: vi.fn(async (key: string) => (key in area.data ? { [key]: area.data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(area.data, items);
    }),
    setAccessLevel: vi.fn(async () => {}),
  };
  return area;
};

const createFakeEvent = <Args extends unknown[]>(): FakeEvent<Args> => {
  const listeners = new Set<(...args: Args) => unknown>();
  return {
    addListener: vi.fn((fn: (...args: Args) => unknown) => listeners.add(fn)),
    removeListener: vi.fn((fn: (...args: Args) => unknown) => listeners.delete(fn)),
    hasListener: vi.fn((fn: (...args: Args) => unknown) => listeners.has(fn)),
    emit: (...args: Args) => listeners.forEach((fn) => fn(...args)),
  };
};

export const createFakeChrome = (): FakeChrome => ({
  tabs: {
    get: vi.fn(),
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    onRemoved: createFakeEvent(),
    onUpdated: createFakeEvent(),
    onActivated: createFakeEvent(),
  },
  windows: {
    update: vi.fn().mockResolvedValue(undefined),
    onFocusChanged: createFakeEvent(),
    WINDOW_ID_NONE: -1,
  },
  contextMenus: {
    create: vi.fn(),
    update: vi.fn(),
    removeAll: vi.fn((done?: () => void) => done?.()),
    onClicked: createFakeEvent(),
  },
  action: {
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue(undefined),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: createFakeEvent(),
    lastError: undefined,
    id: "test-extension-id",
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    getContexts: vi.fn().mockResolvedValue([]),
    ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
  },
  offscreen: {
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    Reason: { USER_MEDIA: "USER_MEDIA" },
  },
  tabCapture: {
    getMediaStreamId: vi.fn(),
  },
  storage: {
    local: createFakeStorageArea(),
    session: createFakeStorageArea(),
  },
});

export const installFakeChrome = (): FakeChrome => {
  const fake = createFakeChrome();
  vi.stubGlobal("chrome", fake);
  return fake;
};

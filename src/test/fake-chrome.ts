import { vi } from "vitest";

/**
 * Minimal fake of the subset of the `chrome.*` extension API this codebase touches.
 * jsdom doesn't provide `chrome`, and pulling in a full mocking library for a handful
 * of callback/event APIs would be more machinery than the surface warrants (see
 * AGENTS.md "No new dependency if ... ~20 lines of local code covers it").
 * Each test installs this on `globalThis.chrome` and resets between runs.
 */
export type FakeChrome = {
  tabs: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    onRemoved: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
      hasListener: ReturnType<typeof vi.fn>;
      /** Test helper: fires the registered listener(s) as Chrome would. */
      emit: (tabId: number) => void;
    };
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    lastError: { message: string } | undefined;
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
};

export const createFakeChrome = (): FakeChrome => {
  const removedListeners = new Set<(tabId: number) => void>();

  return {
    tabs: {
      get: vi.fn(),
      query: vi.fn(),
      sendMessage: vi.fn(),
      onRemoved: {
        addListener: vi.fn((fn: (tabId: number) => void) => removedListeners.add(fn)),
        removeListener: vi.fn((fn: (tabId: number) => void) => removedListeners.delete(fn)),
        hasListener: vi.fn((fn: (tabId: number) => void) => removedListeners.has(fn)),
        emit: (tabId: number) => removedListeners.forEach((fn) => fn(tabId)),
      },
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      lastError: undefined,
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
  };
};

export const installFakeChrome = (): FakeChrome => {
  const fake = createFakeChrome();
  vi.stubGlobal("chrome", fake);
  return fake;
};

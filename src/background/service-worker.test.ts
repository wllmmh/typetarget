import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envelope, type BackgroundResponse, type Envelope, type PopupRequest, type PublicAppState } from "../domain/messages";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { MENU_NEW_FILE_ID } from "./context-menu";

/**
 * The service worker is driven the way Chrome drives it: the real module is loaded against the
 * fake chrome API, and messages, menu clicks and tab events go through the listeners it
 * registered. Each test loads a fresh copy, which is also what a worker restart looks like.
 */

const ORIGIN = "chrome-extension://test-extension-id";
const POPUP = { id: "test-extension-id", url: `${ORIGIN}/src/popup/index.html` };
const OFFSCREEN = { id: "test-extension-id", url: `${ORIGIN}/src/offscreen/index.html` };
const SOURCE_TAB = { id: 3, windowId: 1, url: "https://video.example/watch", title: "A talk" };
const PAGE_TAB = { id: 7, windowId: 1, url: "https://notes.example/", title: "Notes" };
/** The content script in the page tab's top frame. */
const PAGE = { id: "test-extension-id", url: PAGE_TAB.url, tab: PAGE_TAB as chrome.tabs.Tab, frameId: 0 };
const API_KEY = "gsk_test_key_0123456789";

let fake: FakeChrome;
/** What the fake offscreen document is doing; it answers the service worker's messages. */
let offscreen: { open: boolean; capturing: boolean };

/** Delivers a message to the service worker's runtime.onMessage listener, resolving to its reply (if any). */
const send = (payload: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> =>
  new Promise((resolve) => {
    const listener = fake.runtime.onMessage.addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => boolean | undefined;
    if (listener(envelope(payload), sender, resolve) !== true) resolve(undefined);
  });

const popup = async (request: PopupRequest): Promise<BackgroundResponse | undefined> =>
  ((await send(request, POPUP)) as Envelope<BackgroundResponse> | undefined)?.payload;

/** Also waits for the restored state, since every popup request does. */
const getState = async (): Promise<PublicAppState> => {
  const response = await popup({ kind: "get-state" });
  if (response?.kind !== "state") throw new Error(`Expected state, got ${JSON.stringify(response)}`);
  return response.state;
};

const startServiceWorker = async (): Promise<void> => {
  vi.resetModules();
  await import("./service-worker");
};

/** Opens the popup on the source tab and presses Start listening. */
const startListening = async (): Promise<BackgroundResponse | undefined> => {
  fake.tabs.query.mockResolvedValue([SOURCE_TAB]);
  await popup({ kind: "register-active-tab" });
  return popup({ kind: "start-capture", sourceTabId: SOURCE_TAB.id });
};

/** Presses Select field in the popup on the page tab, then clicks a text box there. */
const pickPageField = async (): Promise<void> => {
  fake.tabs.query.mockResolvedValue([PAGE_TAB]);
  await popup({ kind: "begin-destination-selection" });
  await send({ kind: "destination-picked", elementId: "el-1", label: "textarea" }, PAGE);
};

const final = (text: string) => ({ kind: "transcript-event", event: { type: "final", text, timestamp: 1 } });

const insertions = () =>
  fake.tabs.sendMessage.mock.calls.filter(([, message]) => (message as Envelope<{ kind: string }>).payload.kind === "insert-text");

beforeEach(() => {
  fake = installFakeChrome();
  offscreen = { open: false, capturing: false };
  fake.runtime.getContexts.mockImplementation(async () => (offscreen.open ? [{}] : []));
  fake.offscreen.createDocument.mockImplementation(async () => {
    offscreen.open = true;
  });
  fake.runtime.sendMessage.mockImplementation(async (message: Envelope<{ kind: string }>) => {
    switch (message.payload.kind) {
      case "state": // the broadcast to a popup, which may not be open
        return undefined;
      case "get-capture-status":
        return envelope({ kind: "capture-status", capturing: offscreen.capturing, paused: false });
      default:
        return envelope({ kind: "ok" });
    }
  });
  fake.tabs.get.mockImplementation(async (tabId: number) => {
    const tab = [SOURCE_TAB, PAGE_TAB].find((t) => t.id === tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}.`);
    return tab;
  });
  fake.tabs.sendMessage.mockResolvedValue(envelope({ kind: "ok" }));
  fake.tabCapture.getMediaStreamId.mockImplementation((_options: unknown, callback: (streamId: string) => void) =>
    callback("stream-1"),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("popup requests", () => {
  it("are answered only for the popup page: a content script can't save an API key", async () => {
    await startServiceWorker();

    expect(await send({ kind: "set-api-key", provider: "groq", apiKey: API_KEY }, PAGE)).toBeUndefined();
    expect((await getState()).apiKeyProviders).toEqual([]);

    expect(await popup({ kind: "set-api-key", provider: "groq", apiKey: API_KEY })).toEqual({ kind: "ok" });
    expect((await getState()).apiKeyProviders).toEqual(["groq"]);
  });

  it("never send an API key back to the popup", async () => {
    await startServiceWorker();
    await popup({ kind: "set-api-key", provider: "groq", apiKey: API_KEY });

    expect(JSON.stringify(await getState())).not.toContain(API_KEY);
  });

  it("see the settings saved before a restart", async () => {
    Object.assign(fake.storage.local.data, { selectedModel: "base.en", chunkMs: 9_000, showPageIndicators: false });
    await startServiceWorker();

    expect(await getState()).toMatchObject({ selectedModel: "base.en", chunkMs: 9_000, showPageIndicators: false });
  });
});

describe("capture", () => {
  it("starts on the tab the popup was opened on, getting the stream id before loading the model", async () => {
    await startServiceWorker();

    expect(await startListening()).toEqual({ kind: "ok" });

    expect(await getState()).toMatchObject({ status: "capturing", sourceTabId: SOURCE_TAB.id });
    const sent = fake.runtime.sendMessage.mock.calls.map(([message]) => (message as Envelope<{ kind: string }>).payload);
    const startAt = sent.findIndex((m) => m.kind === "start-capture");
    expect(sent[startAt]).toEqual({ kind: "start-capture", streamId: "stream-1" });
    expect(sent.findIndex((m) => m.kind === "load-model")).toBeGreaterThan(startAt);
  });

  it("types the offscreen document's finals into the picked field's own frame, and nobody else's", async () => {
    await startServiceWorker();
    await startListening();
    await pickPageField();

    await send(final("from a page"), PAGE);
    await send(final("hello"), OFFSCREEN);

    await vi.waitFor(() => expect(insertions()).toHaveLength(1));
    expect(insertions()[0]).toEqual([PAGE_TAB.id, envelope({ kind: "insert-text", text: "hello", separator: " " }), { frameId: 0 }]);
  });

  it("types nothing after Stop listening", async () => {
    await startServiceWorker();
    await startListening();
    await pickPageField();
    await popup({ kind: "stop-capture" });

    await send(final("late"), OFFSCREEN);

    await getState();
    expect(insertions()).toHaveLength(0);
  });

  it("stops with an error when the source tab closes", async () => {
    await startServiceWorker();
    await startListening();

    fake.tabs.onRemoved.emit(SOURCE_TAB.id);

    expect(await getState()).toMatchObject({ status: "error", sourceTabId: null, lastError: { code: "source-tab-closed" } });
  });
});

describe("after a service-worker restart", () => {
  const storeRunningCapture = () => {
    fake.storage.session.data.binding = {
      pendingSourceTabId: SOURCE_TAB.id,
      knownTabs: [{ tabId: SOURCE_TAB.id, title: SOURCE_TAB.title, url: SOURCE_TAB.url }],
      destination: null,
      destinationLabel: null,
      capture: { sourceTabId: SOURCE_TAB.id, session: { since: 1_000, reconnects: 0 } },
    };
  };

  it("picks up a capture the offscreen document is still running", async () => {
    storeRunningCapture();
    offscreen = { open: true, capturing: true };

    await startServiceWorker();

    expect(await getState()).toMatchObject({ status: "capturing", sourceTabId: SOURCE_TAB.id, session: { since: 1_000 } });
  });

  it("goes back to idle, and forgets the stored capture, when nothing is capturing any more", async () => {
    storeRunningCapture();

    await startServiceWorker();

    expect(await getState()).toMatchObject({ status: "idle", sourceTabId: null });
    await vi.waitFor(() => expect(fake.storage.session.data.binding).toMatchObject({ capture: null }));
  });
});

describe("messages from the destination's page", () => {
  it("stop typing only when they come from the output's own frame", async () => {
    await startServiceWorker();
    await pickPageField();

    await send({ kind: "stop-typing-requested" }, { ...PAGE, frameId: 2 });
    expect((await getState()).destinationLabel).toBe("Notes — textarea");

    await send({ kind: "stop-typing-requested" }, PAGE);
    expect((await getState()).destinationLabel).toBeNull();
  });
});

describe('with "Show outline" off', () => {
  it("shows REC on the toolbar icon while typing into a field, and clears it on Stop", async () => {
    await startServiceWorker();
    await popup({ kind: "set-show-page-indicators", show: false });
    await pickPageField();
    await startListening();

    expect(fake.action.setBadgeText).toHaveBeenLastCalledWith({ text: "REC" });

    await popup({ kind: "stop-capture" });
    expect(fake.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
  });

  it("opens Type to new file as an editor tab rather than a box on the page", async () => {
    await startServiceWorker();
    await popup({ kind: "set-show-page-indicators", show: false });
    fake.tabs.create.mockResolvedValue({ id: 99 });

    fake.contextMenus.onClicked.emit({ menuItemId: MENU_NEW_FILE_ID, frameId: 0 }, PAGE_TAB);

    await vi.waitFor(() =>
      expect(fake.tabs.create).toHaveBeenCalledWith({ url: `${ORIGIN}/src/editor/index.html`, openerTabId: PAGE_TAB.id }),
    );
    const sentToPage = fake.tabs.sendMessage.mock.calls.map(([, message]) => (message as Envelope<{ kind: string }>).payload.kind);
    expect(sentToPage).not.toContain("open-new-file-field");
  });
});

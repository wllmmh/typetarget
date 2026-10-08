import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, type AppState } from "./state";
import { buildMenuModel, ContextMenu, MENU_LISTEN_HERE_ID, MENU_OUTPUT_DISABLED_ID, MENU_OUTPUT_ID, MENU_NEW_FILE_ID, MENU_STOP_ID, MENU_STOP_TYPING_ID } from "./context-menu";

const tab = (tabId: number, title: string) => ({ tabId, title, url: `https://example.com/${tabId}` });

const stateWith = (overrides: Partial<AppState>): AppState => ({ ...createInitialState(), ...overrides });

describe("buildMenuModel", () => {
  it("enables Stop listening only while capturing, like the popup", () => {
    expect(buildMenuModel(stateWith({}), false).capturing).toBe(false);
    expect(buildMenuModel(stateWith({ status: "paused", pendingSourceTabId: 3, knownTabs: [tab(3, "Video")] }), false).capturing).toBe(true);
    expect(buildMenuModel(stateWith({ status: "error" }), false).capturing).toBe(false);
  });

  it("greys out Type to this field only while the pointer is over the existing destination", () => {
    const destination = { tabId: 9, frameId: 0, elementId: "el-1" };

    expect(buildMenuModel(stateWith({ destination }), true).canPick).toBe(false);
    expect(buildMenuModel(stateWith({ destination }), false).canPick).toBe(true);
    expect(buildMenuModel(stateWith({ destination: null }), true).canPick).toBe(true);
  });

  it("enables Stop typing whenever there is a destination, wherever the pointer is", () => {
    const destination = { tabId: 9, frameId: 0, elementId: "el-1" };

    expect(buildMenuModel(stateWith({ destination }), false).hasDestination).toBe(true);
    expect(buildMenuModel(stateWith({ destination }), true).hasDestination).toBe(true);
    expect(buildMenuModel(stateWith({ destination: null }), false).hasDestination).toBe(false);
  });
});

describe("ContextMenu", () => {
  let menus: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; removeAll: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const callBack = (...args: unknown[]) => {
      const cb = args.at(-1);
      if (typeof cb === "function") cb();
    };
    menus = { create: vi.fn(callBack), update: vi.fn(callBack), remove: vi.fn(callBack), removeAll: vi.fn(callBack) };
    vi.stubGlobal("chrome", { contextMenus: menus, runtime: { lastError: undefined } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a TypeTarget submenu offering Type to this field everywhere (greyed out off text boxes) and Type to new file everywhere", async () => {
    const menu = new ContextMenu();
    await menu.apply(buildMenuModel(stateWith({}), false));

    const created = menus.create.mock.calls.map(([props]) => props);
    expect(created[0]).toMatchObject({ id: "typetarget", title: "TypeTarget", contexts: ["all"] });
    expect(created.filter((p) => p.id !== "typetarget").every((p) => p.parentId !== undefined)).toBe(true);
    expect(created.find((p) => p.id === MENU_OUTPUT_ID)).toMatchObject({ title: "Type to this field", contexts: ["editable"] });
    const twin = created.find((p) => p.id === MENU_OUTPUT_DISABLED_ID);
    expect(twin).toMatchObject({ title: "Type to this field", enabled: false });
    expect(twin.contexts).not.toContain("editable");
    expect(twin.contexts).not.toContain("all");
    expect(twin.contexts).toEqual(expect.arrayContaining(["page", "frame", "selection", "link", "image"]));
    const newFile = created.find((p) => p.id === MENU_NEW_FILE_ID);
    expect(newFile).toMatchObject({ title: "Type to new file", contexts: ["all"] }); // text boxes included
    expect(newFile.enabled).not.toBe(false);
    expect(created.find((p) => p.id === MENU_STOP_TYPING_ID)).toMatchObject({ title: "Stop typing", enabled: false });
    expect(created.find((p) => p.id === MENU_LISTEN_HERE_ID)).toMatchObject({ parentId: "typetarget", title: "Listen to this tab", contexts: ["all"] });
    expect(created.findIndex((p) => p.id === MENU_LISTEN_HERE_ID)).toBe(1); // first item under TypeTarget
    expect(created.find((p) => p.id === MENU_STOP_ID)).toMatchObject({ title: "Stop listening", enabled: false });
    expect(created.map((p) => p.id)).toEqual(["typetarget", MENU_LISTEN_HERE_ID, MENU_STOP_ID, MENU_OUTPUT_ID, MENU_OUTPUT_DISABLED_ID, MENU_NEW_FILE_ID, MENU_STOP_TYPING_ID]);
  });

  it("sends Chrome nothing when the state it reflects hasn't changed", async () => {
    const menu = new ContextMenu();
    const model = buildMenuModel(stateWith({ pendingSourceTabId: 3, knownTabs: [tab(3, "Video")] }), false);
    await menu.apply(model);
    menus.create.mockClear();
    menus.update.mockClear();
    menus.remove.mockClear();

    await menu.apply(buildMenuModel(stateWith({ pendingSourceTabId: 3, knownTabs: [tab(3, "Video")] }), false));

    expect(menus.create).not.toHaveBeenCalled();
    expect(menus.update).not.toHaveBeenCalled();
    expect(menus.remove).not.toHaveBeenCalled();
  });

  it("enables Stop listening while capturing, changing nothing else", async () => {
    const menu = new ContextMenu();
    await menu.apply(buildMenuModel(stateWith({}), false));
    menus.update.mockClear();
    menus.create.mockClear();
    menus.remove.mockClear();

    await menu.apply(buildMenuModel(stateWith({ status: "capturing", pendingSourceTabId: 3, knownTabs: [tab(3, "Video")] }), false));

    expect(menus.update).toHaveBeenCalledTimes(1);
    expect(menus.update).toHaveBeenCalledWith(MENU_STOP_ID, { enabled: true }, expect.any(Function));
    expect(menus.update).not.toHaveBeenCalledWith(MENU_OUTPUT_ID, expect.anything(), expect.anything());
    expect(menus.create).not.toHaveBeenCalled();
    expect(menus.remove).not.toHaveBeenCalled();
  });

  it("enables Stop typing once there is a destination and greys out Type to this field over it", async () => {
    const destination = { tabId: 9, frameId: 0, elementId: "el-1" };
    const menu = new ContextMenu();
    await menu.apply(buildMenuModel(stateWith({}), false));
    menus.update.mockClear();

    await menu.apply(buildMenuModel(stateWith({ destination }), false));
    expect(menus.update).toHaveBeenCalledTimes(1);
    expect(menus.update).toHaveBeenCalledWith(MENU_STOP_TYPING_ID, { enabled: true }, expect.any(Function));

    menus.update.mockClear();
    await menu.apply(buildMenuModel(stateWith({ destination }), true));
    expect(menus.update).toHaveBeenCalledTimes(1);
    expect(menus.update).toHaveBeenCalledWith(MENU_OUTPUT_ID, { enabled: false }, expect.any(Function));
  });
});

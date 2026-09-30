import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, type AppState } from "./state";
import { buildMenuModel, ContextMenu, MENU_OUTPUT_ID, MENU_START_ID, MENU_STOP_ID, sourceTabIdOf } from "./context-menu";

const tab = (tabId: number, title: string) => ({ tabId, title, url: `https://example.com/${tabId}` });

const stateWith = (overrides: Partial<AppState>): AppState => ({ ...createInitialState(), ...overrides });

describe("buildMenuModel", () => {
  it("offers the Start listening submenu when idle and Stop listening while capturing, like the popup", () => {
    expect(buildMenuModel(stateWith({}), false).capturing).toBe(false);
    expect(buildMenuModel(stateWith({ status: "paused", pendingSourceTabId: 3, knownTabs: [tab(3, "Video")] }), false).capturing).toBe(true);
    expect(buildMenuModel(stateWith({ status: "error" }), false).capturing).toBe(false);
  });

  it("lists known tabs as Start listening items, shortening long titles", () => {
    const longTitle = "x".repeat(100);
    const model = buildMenuModel(stateWith({ knownTabs: [tab(3, "Video"), tab(4, longTitle)] }), false);

    expect(model.sources).toEqual([
      { id: "typetarget-source:3", title: "Video" },
      { id: "typetarget-source:4", title: `${"x".repeat(59)}…` },
    ]);
  });

  it("offers Stop typing here only while the pointer is over an existing destination", () => {
    const destination = { tabId: 9, frameId: 0, elementId: "el-1" };

    expect(buildMenuModel(stateWith({ destination }), true).output).toBe("Stop typing here");
    expect(buildMenuModel(stateWith({ destination }), false).output).toBe("Type here");
    expect(buildMenuModel(stateWith({ destination: null }), true).output).toBe("Type here");
  });
});

describe("sourceTabIdOf", () => {
  it("reads the tab id back from a source item id, and ignores other items", () => {
    expect(sourceTabIdOf("typetarget-source:42")).toBe(42);
    expect(sourceTabIdOf("typetarget-stop")).toBeNull();
    expect(sourceTabIdOf("typetarget-source:nope")).toBeNull();
    expect(sourceTabIdOf(7)).toBeNull();
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

  it("builds a TypeTarget submenu whose output item appears only on text boxes", async () => {
    const menu = new ContextMenu();
    await menu.apply(buildMenuModel(stateWith({}), false));

    const created = menus.create.mock.calls.map(([props]) => props);
    expect(created[0]).toMatchObject({ id: "typetarget", title: "TypeTarget", contexts: ["all"] });
    expect(created.filter((p) => p.id !== "typetarget").every((p) => p.parentId !== undefined)).toBe(true);
    expect(created.find((p) => p.id === MENU_OUTPUT_ID)).toMatchObject({ contexts: ["editable"] });
    expect(created.find((p) => p.id === MENU_START_ID)).toMatchObject({ parentId: "typetarget", title: "Start listening", contexts: ["all"] });
    expect(created.find((p) => p.id === MENU_STOP_ID)).toMatchObject({ title: "Stop listening", visible: false });
    expect(created.some((p) => p.id === "typetarget-source-none" && p.parentId === MENU_START_ID && p.enabled === false)).toBe(true);
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

  it("swaps Start listening for Stop listening while capturing, leaving the tab items alone", async () => {
    const menu = new ContextMenu();
    const knownTabs = [tab(3, "Video"), tab(4, "Podcast")];
    await menu.apply(buildMenuModel(stateWith({ knownTabs }), false));
    menus.update.mockClear();
    menus.create.mockClear();
    menus.remove.mockClear();

    await menu.apply(buildMenuModel(stateWith({ status: "capturing", knownTabs }), false));

    expect(menus.update).toHaveBeenCalledWith(MENU_START_ID, { visible: false }, expect.any(Function));
    expect(menus.update).toHaveBeenCalledWith(MENU_STOP_ID, { visible: true }, expect.any(Function));
    expect(menus.update).not.toHaveBeenCalledWith(MENU_OUTPUT_ID, expect.anything(), expect.anything());
    expect(menus.create).not.toHaveBeenCalled();
    expect(menus.remove).not.toHaveBeenCalled();
  });

  it("rebuilds the source list when tabs come or go", async () => {
    const menu = new ContextMenu();
    await menu.apply(buildMenuModel(stateWith({ knownTabs: [tab(3, "Video")] }), false));
    menus.create.mockClear();

    await menu.apply(buildMenuModel(stateWith({ knownTabs: [tab(3, "Video"), tab(4, "Podcast")] }), false));

    expect(menus.remove).toHaveBeenCalledWith("typetarget-source:3", expect.any(Function));
    expect(menus.create.mock.calls.map(([props]) => props)).toEqual([
      { id: "typetarget-source:3", title: "Video", parentId: MENU_START_ID, contexts: ["all"] },
      { id: "typetarget-source:4", title: "Podcast", parentId: MENU_START_ID, contexts: ["all"] },
    ]);
  });
});

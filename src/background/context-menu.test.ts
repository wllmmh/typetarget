import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, type AppState } from "./state";
import { buildMenuModel, ContextMenu, MENU_OUTPUT_ID, MENU_START_STOP_ID, sourceTabIdOf } from "./context-menu";

const tab = (tabId: number, title: string) => ({ tabId, title, url: `https://example.com/${tabId}` });

const stateWith = (overrides: Partial<AppState>): AppState => ({ ...createInitialState(), ...overrides });

describe("buildMenuModel", () => {
  it("offers Start listening, disabled until a source tab is chosen", () => {
    expect(buildMenuModel(stateWith({}), false).startStop).toEqual({ title: "Start listening", enabled: false });
    expect(buildMenuModel(stateWith({ pendingSourceTabId: 3 }), false).startStop).toEqual({ title: "Start listening", enabled: true });
  });

  it("offers Stop listening and locks the source list while capturing, like the popup", () => {
    const model = buildMenuModel(stateWith({ status: "paused", pendingSourceTabId: 3, knownTabs: [tab(3, "Video")] }), false);

    expect(model.startStop).toEqual({ title: "Stop listening", enabled: true });
    expect(model.sourcesEnabled).toBe(false);
  });

  it("lists known tabs as sources with the chosen one checked, shortening long titles", () => {
    const longTitle = "x".repeat(100);
    const model = buildMenuModel(stateWith({ pendingSourceTabId: 4, knownTabs: [tab(3, "Video"), tab(4, longTitle)] }), false);

    expect(model.sources).toEqual([
      { id: "typetarget-source:3", title: "Video", checked: false },
      { id: "typetarget-source:4", title: `${"x".repeat(59)}…`, checked: true },
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
    expect(sourceTabIdOf("typetarget-start-stop")).toBeNull();
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
    expect(created.find((p) => p.id === MENU_START_STOP_ID)).toMatchObject({ contexts: ["all"] });
    expect(created.some((p) => p.id === "typetarget-source-none" && p.enabled === false)).toBe(true);
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

  it("updates just the changed items: Start listening becomes Stop listening, sources lock, the check moves", async () => {
    const menu = new ContextMenu();
    const knownTabs = [tab(3, "Video"), tab(4, "Podcast")];
    await menu.apply(buildMenuModel(stateWith({ pendingSourceTabId: 3, knownTabs }), false));
    menus.update.mockClear();

    await menu.apply(buildMenuModel(stateWith({ status: "capturing", pendingSourceTabId: 4, knownTabs }), false));

    expect(menus.update).toHaveBeenCalledWith(MENU_START_STOP_ID, { title: "Stop listening", enabled: true }, expect.any(Function));
    expect(menus.update).toHaveBeenCalledWith("typetarget-source:3", { checked: false, enabled: false }, expect.any(Function));
    expect(menus.update).toHaveBeenCalledWith("typetarget-source:4", { checked: true, enabled: false }, expect.any(Function));
    expect(menus.update).not.toHaveBeenCalledWith(MENU_OUTPUT_ID, expect.anything(), expect.anything());
  });

  it("rebuilds the source list when tabs come or go", async () => {
    const menu = new ContextMenu();
    await menu.apply(buildMenuModel(stateWith({ knownTabs: [tab(3, "Video")] }), false));
    menus.create.mockClear();

    await menu.apply(buildMenuModel(stateWith({ knownTabs: [tab(3, "Video"), tab(4, "Podcast")] }), false));

    expect(menus.remove).toHaveBeenCalledWith("typetarget-source:3", expect.any(Function));
    expect(menus.create.mock.calls.map(([props]) => props.id)).toEqual(["typetarget-source:3", "typetarget-source:4"]);
  });
});

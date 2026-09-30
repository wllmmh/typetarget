/**
 * The page right-click menu: a "TypeTarget" submenu, available anywhere on a page, holding
 * Start listening (a submenu with one item per eligible tab; choosing one starts capturing it),
 * Stop listening (shown instead of Start while capturing) and — only when right-clicking a text
 * box — Type here/Stop typing here. It mirrors the popup's equivalent controls (worded
 * differently there) so they can be used from the tab the user is typing into, without opening
 * the popup.
 *
 * `buildMenuModel` is a pure view of app state; `ContextMenu` applies it to Chrome, sending
 * only what changed (state is broadcast every second while capturing).
 */
import type { AppState } from "./state";

export const MENU_ROOT_ID = "typetarget";
export const MENU_START_ID = "typetarget-start";
export const MENU_STOP_ID = "typetarget-stop";
export const MENU_OUTPUT_ID = "typetarget-output";
const SOURCE_ITEM_PREFIX = "typetarget-source:";
const NO_SOURCES_ID = "typetarget-source-none";
/** Tab titles can be very long; the menu is not the place to read them in full. */
const MAX_SOURCE_TITLE_LENGTH = 60;

type SourceItem = { id: string; title: string };

export type MenuModel = {
  /** While capturing, Stop listening is shown in place of the Start listening submenu. */
  capturing: boolean;
  /** The Start listening submenu's items: each known tab is one to start capturing. */
  sources: SourceItem[];
  output: "Type here" | "Stop typing here";
};

/** Same test as the popup's Start/Stop toggle and the service worker's setSourceTab guard. */
export const isCapturing = (status: AppState["status"]): boolean => status !== "idle" && status !== "error";

const truncate = (title: string): string =>
  title.length > MAX_SOURCE_TITLE_LENGTH ? `${title.slice(0, MAX_SOURCE_TITLE_LENGTH - 1)}…` : title;

/**
 * `pointerOverDestination` comes from the destination's own frame (see service-worker.ts):
 * Chrome can't say which element a menu opens on, so that report is how the output item
 * knows to offer "Stop typing here".
 */
export const buildMenuModel = (state: AppState, pointerOverDestination: boolean): MenuModel => {
  return {
    capturing: isCapturing(state.status),
    sources: state.knownTabs.map((tab) => ({ id: `${SOURCE_ITEM_PREFIX}${tab.tabId}`, title: truncate(tab.title) })),
    output: pointerOverDestination && state.destination ? "Stop typing here" : "Type here",
  };
};

/** The tab a Start listening item stands for, or null if `menuItemId` isn't one. */
export const sourceTabIdOf = (menuItemId: string | number): number | null => {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(SOURCE_ITEM_PREFIX)) return null;
  const tabId = Number(menuItemId.slice(SOURCE_ITEM_PREFIX.length));
  return Number.isInteger(tabId) ? tabId : null;
};

const warnIfFailed = () => {
  if (chrome.runtime.lastError) console.warn(`TypeTarget: right-click menu update failed (${chrome.runtime.lastError.message}).`);
};

const sourceListKey = (model: MenuModel): string => JSON.stringify(model.sources.map(({ id, title }) => [id, title]));

export class ContextMenu {
  private applied: MenuModel | null = null;
  private readonly created: Promise<void>;

  /**
   * Created on every service-worker start, not only in runtime.onInstalled: an install whose
   * onInstalled ran older code (or never fired for a reload) would otherwise never get the
   * menu. Clearing first also drops items from older builds.
   */
  constructor() {
    this.created = new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: MENU_ROOT_ID, title: "TypeTarget", contexts: ["all"] }, warnIfFailed);
        chrome.contextMenus.create({ id: MENU_START_ID, parentId: MENU_ROOT_ID, title: "Start listening", contexts: ["all"] }, warnIfFailed);
        chrome.contextMenus.create(
          { id: MENU_STOP_ID, parentId: MENU_ROOT_ID, title: "Stop listening", visible: false, contexts: ["all"] },
          warnIfFailed,
        );
        chrome.contextMenus.create(
          { id: MENU_OUTPUT_ID, parentId: MENU_ROOT_ID, title: "Type here", contexts: ["editable"] },
          () => {
            warnIfFailed();
            resolve();
          },
        );
      });
    });
  }

  async apply(model: MenuModel): Promise<void> {
    await this.created;
    const previous = this.applied;
    this.applied = model;

    if (previous?.capturing !== model.capturing) {
      chrome.contextMenus.update(MENU_START_ID, { visible: !model.capturing }, warnIfFailed);
      chrome.contextMenus.update(MENU_STOP_ID, { visible: model.capturing }, warnIfFailed);
    }
    if (previous?.output !== model.output) {
      chrome.contextMenus.update(MENU_OUTPUT_ID, { title: model.output }, warnIfFailed);
    }
    if (!previous || sourceListKey(previous) !== sourceListKey(model)) {
      this.replaceSources(previous?.sources ?? [], model);
    }
  }

  private replaceSources(previous: SourceItem[], model: MenuModel): void {
    // With no previous model, the placeholder may or may not exist; removing a missing item is harmless.
    for (const id of previous.length > 0 ? previous.map((item) => item.id) : [NO_SOURCES_ID]) {
      chrome.contextMenus.remove(id, () => void chrome.runtime.lastError);
    }
    if (model.sources.length === 0) {
      chrome.contextMenus.create(
        { id: NO_SOURCES_ID, parentId: MENU_START_ID, title: "Open TypeTarget on a tab to capture it", enabled: false, contexts: ["all"] },
        warnIfFailed,
      );
      return;
    }
    for (const item of model.sources) {
      chrome.contextMenus.create(
        { ...item, parentId: MENU_START_ID, contexts: ["all"] },
        warnIfFailed,
      );
    }
  }
}

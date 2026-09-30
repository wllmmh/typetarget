/**
 * The page right-click menu: a "TypeTarget" submenu, available anywhere on a page, holding
 * Listen to this tab (records the tab and starts capturing it in one click — the click itself
 * grants the activeTab access both need, so a tab never opened in the popup works too),
 * Stop listening (greyed out unless capturing), Type to this field (enabled only on a text box
 * that isn't already the output) and Stop typing (greyed out while there is no output box; works
 * from anywhere). Every item is always shown, so the menu keeps its shape. It mirrors the popup's equivalent controls (worded
 * differently there) so they can be used from the tab the user is typing into, without opening
 * the popup. There is deliberately no tab list: Chrome gives no event when a menu opens, so a
 * list could only show tabs already granted access, and "Listen to this tab" covers the rest.
 *
 * `buildMenuModel` is a pure view of app state; `ContextMenu` applies it to Chrome, sending
 * only what changed (state is broadcast every second while capturing).
 */
import type { AppState } from "./state";

export const MENU_ROOT_ID = "typetarget";
export const MENU_LISTEN_HERE_ID = "typetarget-listen-here";
export const MENU_STOP_ID = "typetarget-stop";
export const MENU_OUTPUT_ID = "typetarget-output";
/** A permanently greyed-out stand-in for the output item, shown everywhere but text boxes. */
export const MENU_OUTPUT_UNAVAILABLE_ID = "typetarget-output-unavailable";
export const MENU_STOP_TYPING_ID = "typetarget-stop-typing";

/** Which items are enabled; every item is always visible. */
export type MenuModel = {
  /** Stop listening. */
  capturing: boolean;
  /** Type to this field, on a text box: off only on the box that already is the output. */
  canPick: boolean;
  /** Stop typing: on whenever there is an output box, wherever the menu is opened. */
  hasDestination: boolean;
};

/** Same test as the popup's Start/Stop toggle and the service worker's setSourceTab guard. */
export const isCapturing = (status: AppState["status"]): boolean => status !== "idle" && status !== "error";

/**
 * `pointerOverDestination` comes from the destination's own frame (see service-worker.ts):
 * Chrome can't say which element a menu opens on, so that report is how Type to this field
 * knows it is on the box that is already the output.
 */
export const buildMenuModel = (state: AppState, pointerOverDestination: boolean): MenuModel => ({
  capturing: isCapturing(state.status),
  canPick: !(pointerOverDestination && state.destination),
  hasDestination: state.destination !== null,
});

const warnIfFailed = () => {
  if (chrome.runtime.lastError) console.warn(`TypeTarget: right-click menu update failed (${chrome.runtime.lastError.message}).`);
};

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
        chrome.contextMenus.create(
          { id: MENU_LISTEN_HERE_ID, parentId: MENU_ROOT_ID, title: "Listen to this tab", contexts: ["all"] },
          warnIfFailed,
        );
        chrome.contextMenus.create(
          { id: MENU_STOP_ID, parentId: MENU_ROOT_ID, title: "Stop listening", enabled: false, contexts: ["all"] },
          warnIfFailed,
        );
        chrome.contextMenus.create(
          { id: MENU_OUTPUT_ID, parentId: MENU_ROOT_ID, title: "Type to this field", contexts: ["editable"] },
          warnIfFailed,
        );
        // Chrome can't enable an item per click, but it can pick items by what was clicked: the
        // real item appears only on text boxes, this greyed-out twin in the other contexts, so the
        // menu always reads as one item. "frame" and "selection" are left out because they also
        // apply on text boxes, where both would show. So text selected outside a text box shows neither.
        chrome.contextMenus.create(
          {
            id: MENU_OUTPUT_UNAVAILABLE_ID,
            parentId: MENU_ROOT_ID,
            title: "Type to this field",
            enabled: false,
            contexts: ["page", "link", "image", "video", "audio"],
          },
          warnIfFailed,
        );
        chrome.contextMenus.create(
          { id: MENU_STOP_TYPING_ID, parentId: MENU_ROOT_ID, title: "Stop typing", enabled: false, contexts: ["all"] },
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
      chrome.contextMenus.update(MENU_STOP_ID, { enabled: model.capturing }, warnIfFailed);
    }
    if (previous?.canPick !== model.canPick) {
      chrome.contextMenus.update(MENU_OUTPUT_ID, { enabled: model.canPick }, warnIfFailed);
    }
    if (previous?.hasDestination !== model.hasDestination) {
      chrome.contextMenus.update(MENU_STOP_TYPING_ID, { enabled: model.hasDestination }, warnIfFailed);
    }
  }
}

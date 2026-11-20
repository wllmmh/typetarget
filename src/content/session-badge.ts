/**
 * The listening timer and the output's buttons, drawn as two rounded chips on translucent near-black
 * (blurring the page behind) just above the destination's rounded frame (see highlight.ts). The
 * text and icons are neutral white; the frame carries the state: green while
 * listening, the app icon's red when stopped, grey while paused or while a lost connection is
 * being re-established. The title chip is on the left: state icon, then "TypeTarget" and the
 * timer while listening, or "Not listening" when stopped. Never the source tab's name: this is
 * the destination page's DOM, which its scripts can read.
 * Fixed-positioned at the document root rather than inserted beside the element, so the
 * page's layout and `overflow: hidden` containers can't move or clip it. It is re-placed on
 * every animation frame, not just on scroll/resize: chat boxes grow as text is typed and
 * pages shift layout without firing either event. Only ever one, for the one destination.
 *
 * The buttons share one button bar at the row's right end (a separate element, so the title
 * can let clicks through to the page): Save (downloads the box's text as .txt) and X (the same as the
 * right-click menu's Stop typing). Minimize (or Restore) and Open in new tab sit between them —
 * on a page's own text box, both move the output into a new-file box or editor tab; in that
 * editor tab, Move back to page does. Icons are Material Icons (Apache 2.0), 24px paths.
 */
import { formatElapsed } from "../domain/elapsed";
import { t } from "../domain/i18n";
import type { SessionIndicator } from "../domain/messages";
import { DESTINATION_COLOR, DESTINATION_REACH_PX, setDestinationColor } from "./highlight";
import { isUserEvent } from "./user-event";
import { findClippers, visibleBox } from "./visible-box";

/** What the badge shows: the background's session state, or — local to this frame — a "Type to
 * new file" box kept on the page after Stop typing, which is no longer the output. */
export type BadgeIndicator = SessionIndicator | { state: "not-typing" };

export const SESSION_BADGE_ID = "typetarget-session-badge";
export const SESSION_BADGE_CONTROLS_ID = "typetarget-session-badge-controls";

/** What the buttons on the outline's top right do. */
export type BadgeActions = {
  onClose: () => void;
  onSave: () => void;
  /** Everywhere but the editor tab: the "Type to new file" box shrinks itself; a page's own text
   * box hands its text to a minimized new-file box instead. */
  windowControls?: { minimized: boolean; onToggleMinimize: () => void; onOpenInTab: () => void };
  /** Only in the editor tab (see src/editor/main.ts). */
  onMoveBack?: () => void;
  /** The X's label, when it does more than stop typing (e.g. closes a kept new-file box). */
  closeLabel?: string;
};

const COLOR: Record<BadgeIndicator["state"], string> = {
  listening: "#1f9d55",
  paused: "#6b7280",
  reconnecting: "#6b7280",
  stopped: DESTINATION_COLOR,
  "not-typing": "#6b7280",
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Material Icons' 24px paths (https://github.com/google/material-design-icons): play_arrow,
 * pause, sync, stop. The badge's icon is only this and the timer. */
const ICON_PATHS: Record<BadgeIndicator["state"], string> = {
  listening: "M8 5v14l11-7z",
  paused: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  reconnecting:
    "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z",
  stopped: "M6 6h12v12H6z",
  "not-typing": "M6 6h12v12H6z",
};

/** close, file_download, remove, crop_square, open_in_new, arrow_back. */
const CLOSE_PATH = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";
const SAVE_PATH = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z";
const MINIMIZE_PATH = "M19 13H5v-2h14v2z";
const RESTORE_PATH = "M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H6V6h12v12z";
const OPEN_IN_TAB_PATH =
  "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z";
/** A left arrow: the text goes back where it came from. */
const MOVE_BACK_PATH = "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z";

const createSvg = (path: string, size: number, style: string): SVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", style);
  const el = document.createElementNS(SVG_NS, "path");
  el.setAttribute("d", path);
  el.setAttribute("fill", "currentColor");
  svg.append(el);
  return svg;
};

const createIcon = (state: BadgeIndicator["state"]): SVGElement => createSvg(ICON_PATHS[state], 20, "display: block; flex: none");

/** On Material's 4px grid: 32px buttons with 20px icons in a 36px bar, 4px above the frame. */
const ROW_HEIGHT_PX = 36;
const BUTTON_SIZE_PX = 32;
const ROW_GAP_PX = 4;
/** The chips' corners; a button's are 2px tighter, so they stay concentric with its bar's. */
const CHIP_RADIUS_PX = 8;

/** Shared by the title chip and the button bar: white text on translucent near-black. */
const CHIP_STYLE = [
  "all: initial",
  "position: fixed",
  "z-index: 2147483647",
  "box-sizing: border-box",
  "align-items: center",
  `height: ${ROW_HEIGHT_PX}px`,
  `border-radius: ${CHIP_RADIUS_PX}px`,
  
  "background: rgb(16 16 16 / 0.8)",
  "backdrop-filter: blur(8px)",
  "color: #fff",
  "white-space: nowrap",
];

/** `all: initial` first, so page styles for `div` can't reshape it. `display` is set by place(). */
const TITLE_STYLE = [
  ...CHIP_STYLE,
  "pointer-events: none",
  "gap: 8px",
  "padding: 0 12px 0 8px",
  "font: 500 13px/16px system-ui, sans-serif",
  "font-variant-numeric: tabular-nums",
].join("; ");

/** The button bar: clickable, the buttons edge to edge inside a 2px inset. */
const CONTROLS_STYLE = [...CHIP_STYLE, "padding: 0 2px"].join("; ");

/** Material's icon button, in the bar's color. */
const BUTTON_STYLE = [
  "all: initial",
  "display: flex",
  "align-items: center",
  "justify-content: center",
  "box-sizing: border-box",
  `width: ${BUTTON_SIZE_PX}px`,
  `height: ${BUTTON_SIZE_PX}px`,
  `border-radius: ${CHIP_RADIUS_PX - 2}px`,
  "color: inherit",
  "cursor: pointer",
].join("; ");

/* Hover and keyboard focus show the same wash (the button's state layer); `all: initial`
 * removed the focus ring. */
const BUTTON_HIGHLIGHT = "color-mix(in srgb, currentColor 14%, transparent)";

const createButton = (label: string, path: string, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("style", BUTTON_STYLE);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createSvg(path, 20, "display: block"));
  const highlight = (on: boolean) => () => {
    button.style.background = on ? BUTTON_HIGHLIGHT : "";
  };
  button.addEventListener("mouseenter", highlight(true));
  button.addEventListener("mouseleave", highlight(false));
  button.addEventListener("focus", highlight(true));
  button.addEventListener("blur", highlight(false));
  button.addEventListener("click", (e) => {
    if (isUserEvent(e)) onClick(); // a page script's synthetic click must not operate the output
  });
  return button;
};

const createControls = (): HTMLElement => {
  const el = document.createElement("div");
  el.id = SESSION_BADGE_CONTROLS_ID;
  el.setAttribute("style", CONTROLS_STYLE);
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", t("badgeControls"));
  // Keeps focus (and the caret) in the output box, and keeps the page from treating the press
  // as a click outside its own widget, e.g. a chat composer that collapses on outside clicks.
  // Capture-phase page listeners still see it; nothing here can stop those.
  for (const type of ["pointerdown", "mousedown"] as const) {
    el.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }
  el.addEventListener("click", (e) => e.stopPropagation());
  return el;
};

/** Which buttons the controls hold, so they are rebuilt only when that changes. */
const controlsLayout = ({ windowControls, onMoveBack, closeLabel }: BadgeActions): string =>
  `${windowControls ? (windowControls.minimized ? "minimized" : "new-file") : onMoveBack ? "editor" : "plain"}:${closeLabel ?? ""}`;

const fillControls = (el: HTMLElement, { windowControls, onMoveBack, closeLabel }: BadgeActions): void => {
  el.replaceChildren(
    createButton(t("badgeSave"), SAVE_PATH, () => actions?.onSave()),
    ...(windowControls
      ? [
          windowControls.minimized
            ? createButton(t("badgeRestore"), RESTORE_PATH, () => actions?.windowControls?.onToggleMinimize())
            : createButton(t("badgeMinimize"), MINIMIZE_PATH, () => actions?.windowControls?.onToggleMinimize()),
          createButton(t("badgeOpenInTab"), OPEN_IN_TAB_PATH, () => actions?.windowControls?.onOpenInTab()),
        ]
      : []),
    ...(onMoveBack ? [createButton(t("badgeMoveBack"), MOVE_BACK_PATH, () => actions?.onMoveBack?.())] : []),
    createButton(closeLabel ?? t("badgeStopTyping"), CLOSE_PATH, () => actions?.onClose()),
  );
};

let badge: HTMLElement | null = null;
let controls: HTMLElement | null = null;
let actions: BadgeActions | null = null;
let anchor: Element | null = null;
let indicator: BadgeIndicator | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let frame: number | null = null;
let clippers: Element[] = [];
/** Last position written, so the per-frame loop touches the style only when the element moved. */
let placed = "";
/** The badge's icon is rebuilt only when the state changes, not on each tick. */
let shownState: BadgeIndicator["state"] | null = null;
let labelNode: Text | null = null;
let shownLayout: string | null = null;

const render = (): void => {
  if (!badge || !anchor || !indicator) return;
  if (shownState !== indicator.state || !labelNode) {
    shownState = indicator.state;
    labelNode = document.createTextNode("");
    badge.replaceChildren(createIcon(indicator.state), labelNode);
  }
  // "TypeTarget" and the timer are for a session that is both listening and typing.
  labelNode.data =
    indicator.state === "not-typing"
      ? t("badgeNotTyping")
      : indicator.state === "stopped"
        ? t("badgeNotListening")
        : `TypeTarget ${formatElapsed(Date.now() - indicator.since)}`;
  setDestinationColor(COLOR[indicator.state]); // the outline always matches the label's color
  placed = ""; // the text may have changed the badge's height
  clippers = findClippers(anchor);
  place();
};

/** Keeps the badge and its buttons sitting on the outline's top edge. Cheap enough to run every frame. */
const place = (): void => {
  if (!badge || !controls || !anchor) return;
  const rect = anchor.isConnected ? visibleBox(anchor, clippers) : null;
  if (!rect) {
    if (placed !== "hidden") {
      badge.style.display = "none";
      controls.style.display = "none";
    }
    placed = "hidden";
    return;
  }
  if (placed === "hidden" || placed === "") {
    badge.style.display = "flex";
    controls.style.display = "flex";
  }
  // The frame (highlight.ts) is drawn outside the element, so the title's left edge is the
  // frame's outer edge (the button bar's right edge likewise), and the row's bottom sits a gap
  // above the frame. Where that is off the top of the viewport the row goes just inside the
  // element's top edge instead.
  const reach = DESTINATION_REACH_PX;
  const rowBottom = rect.top - reach - ROW_GAP_PX;
  const inside = rect.top + ROW_GAP_PX;
  const above = rowBottom - badge.offsetHeight;
  const top = `${above >= 0 ? above : inside}px`;
  const left = `${Math.max(0, rect.left - reach)}px`;
  const controlsAbove = rowBottom - controls.offsetHeight;
  const controlsTop = `${controlsAbove >= 0 ? controlsAbove : inside}px`;
  const controlsLeft = `${Math.max(0, Math.min(rect.right + reach, window.innerWidth) - controls.offsetWidth)}px`;
  const key = `${top} ${left} ${controlsTop} ${controlsLeft}`;
  if (placed === key) return;
  placed = key;
  badge.style.top = top;
  badge.style.left = left;
  controls.style.top = controlsTop;
  controls.style.left = controlsLeft;
};

const follow = (): void => {
  place();
  frame = requestAnimationFrame(follow);
};

const remove = (): void => {
  setDestinationColor(null);
  if (ticker !== null) clearInterval(ticker);
  ticker = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  placed = "";
  clippers = [];
  badge?.remove();
  badge = null;
  controls?.remove();
  controls = null;
  actions = null;
  shownState = null;
  labelNode = null;
  shownLayout = null;
};

/** Shows the timer and the buttons on `el`, or removes them when either of the first two is null. */
export const setSessionBadge = (el: Element | null, next: BadgeIndicator | null, nextActions: BadgeActions): void => {
  anchor = el;
  indicator = next;
  actions = nextActions;
  if (!el || !next) {
    remove();
    return;
  }
  if (!badge) {
    // A badge left by an earlier injection (e.g. before the extension was reloaded) keeps its
    // old build's placement and would sit beside this one; same reason highlight.ts rewrites
    // its style element.
    document.getElementById(SESSION_BADGE_ID)?.remove();
    document.getElementById(SESSION_BADGE_CONTROLS_ID)?.remove();
    badge = document.createElement("div");
    badge.id = SESSION_BADGE_ID;
    badge.setAttribute("style", TITLE_STYLE);
    badge.setAttribute("aria-hidden", "true");
    controls = createControls();
    document.documentElement.append(badge, controls);
    ticker = setInterval(render, 1000);
    frame = requestAnimationFrame(follow);
  }
  const layout = controlsLayout(nextActions);
  if (controls && layout !== shownLayout) {
    shownLayout = layout;
    fillControls(controls, nextActions);
  }
  render();
};

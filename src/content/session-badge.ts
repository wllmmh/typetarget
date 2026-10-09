/**
 * The listening timer, drawn as a small tab sitting on top of the destination's double
 * outline (see highlight.ts), which takes on its color: green while listening, the app icon's
 * red when stopped, grey while paused or while a lost connection is being re-established.
 * Fixed-positioned at the document root rather than inserted beside the element, so the
 * page's layout and `overflow: hidden` containers can't move or clip it. It is re-placed on
 * every animation frame, not just on scroll/resize: chat boxes grow as text is typed and
 * pages shift layout without firing either event. Only ever one, for the one destination. Reads: state icon, "TypeTarget", the timer.
 * Never the source tab's name: this is the destination page's DOM, which its scripts can read.
 *
 * A second tab of the same color sits on the outline's top right with the output's buttons:
 * Save (downloads the box's text as .txt) and X (the same as the right-click menu's Stop typing).
 * Minimize (or Restore) and Open in new tab sit between them — on a page's own text box, both
 * move the output into a new-file box or editor tab; in that editor tab, Move back to page does.
 */
import { formatElapsed } from "../domain/elapsed";
import type { SessionIndicator } from "../domain/messages";
import { DESTINATION_COLOR, setDestinationColor } from "./highlight";
import { isUserEvent } from "./user-event";

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

type IconShape = { tag: "path" | "rect"; attrs: Record<string, string> };

/** Shapes on the same 12x12 grid as the popup's icons: play while listening, pause bars when
 * paused, a cross while reconnecting, a square when stopped. The badge is only this and the timer. */
const ICON_SHAPES: Record<BadgeIndicator["state"], IconShape> = {
  listening: { tag: "path", attrs: { d: "M2 1.2 L10.5 6 L2 10.8 Z", fill: "currentColor" } },
  paused: { tag: "path", attrs: { d: "M1.5 1 H4.5 V11 H1.5 Z M7.5 1 H10.5 V11 H7.5 Z", fill: "currentColor" } },
  reconnecting: { tag: "path", attrs: { d: "M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5", stroke: "currentColor", "stroke-width": "2", fill: "none" } },
  stopped: { tag: "rect", attrs: { x: "1.5", y: "1.5", width: "9", height: "9", fill: "currentColor" } },
  "not-typing": { tag: "rect", attrs: { x: "1.5", y: "1.5", width: "9", height: "9", fill: "currentColor" } },
};

const CLOSE_SHAPE: IconShape = { tag: "path", attrs: { d: "M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5", stroke: "currentColor", "stroke-width": "1.75", fill: "none" } };
const SAVE_SHAPE: IconShape = {
  tag: "path",
  attrs: { d: "M6 1 V8 M3 5 L6 8 L9 5 M1.5 10.75 H10.5", stroke: "currentColor", "stroke-width": "1.5", fill: "none" },
};

const MINIMIZE_SHAPE: IconShape = { tag: "path", attrs: { d: "M2 9.5 H10", stroke: "currentColor", "stroke-width": "1.75", fill: "none" } };
const RESTORE_SHAPE: IconShape = {
  tag: "rect",
  attrs: { x: "2", y: "2", width: "8", height: "8", stroke: "currentColor", "stroke-width": "1.5", fill: "none" },
};
/** A box with an arrow leaving it: the text opens elsewhere. */
const OPEN_IN_TAB_SHAPE: IconShape = {
  tag: "path",
  attrs: { d: "M7 1.5 H10.5 V5 M10.5 1.5 L5.5 6.5 M9 7.5 V10.5 H1.5 V3 H4.5", stroke: "currentColor", "stroke-width": "1.5", fill: "none" },
};

/** An arrow turning back down-left: the text goes back where it came from. */
const MOVE_BACK_SHAPE: IconShape = {
  tag: "path",
  attrs: { d: "M10 2 V7 H3 M5.5 4.5 L3 7 L5.5 9.5", stroke: "currentColor", "stroke-width": "1.5", fill: "none" },
};

const createSvg = (shape: IconShape, style: string): SVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", style);
  const el = document.createElementNS(SVG_NS, shape.tag);
  for (const [name, value] of Object.entries(shape.attrs)) el.setAttribute(name, value);
  svg.append(el);
  return svg;
};

const createIcon = (state: BadgeIndicator["state"]): SVGElement =>
  createSvg(ICON_SHAPES[state], "display: inline-block; vertical-align: -1px; margin-right: 4px");

/** `all: initial` first, so page styles for `div` can't reshape it. */
const BASE_STYLE = [
  "all: initial",
  "position: fixed",
  "z-index: 2147483647",
  "pointer-events: none",
  "box-sizing: border-box",
  "padding: 1px 6px",
  "border-radius: 3px 3px 0 0",
  "color: #fff",
  "font: 600 11px/16px system-ui, sans-serif",
  "font-variant-numeric: tabular-nums",
  "white-space: nowrap",
].join("; ");

/** The buttons' tab: the badge's look, but clickable. */
const CONTROLS_STYLE = [BASE_STYLE, "pointer-events: auto", "padding: 1px 2px"].join("; ");

const BUTTON_STYLE = [
  "all: initial",
  "display: inline-block",
  "box-sizing: border-box",
  "width: 20px",
  "height: 16px",
  "border-radius: 2px",
  "color: #fff",
  "cursor: pointer",
  "text-align: center",
  "vertical-align: top",
  "line-height: 16px",
].join("; ");

/** Hover and keyboard focus show the same light wash; `all: initial` removed the focus ring. */
const BUTTON_HIGHLIGHT = "rgba(255, 255, 255, 0.3)";

const createButton = (label: string, shape: IconShape, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("style", BUTTON_STYLE);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createSvg(shape, "display: inline-block; vertical-align: -1px"));
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
  el.setAttribute("aria-label", "TypeTarget output");
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
    createButton("Save as .txt", SAVE_SHAPE, () => actions?.onSave()),
    ...(windowControls
      ? [
          windowControls.minimized
            ? createButton("Restore", RESTORE_SHAPE, () => actions?.windowControls?.onToggleMinimize())
            : createButton("Minimize", MINIMIZE_SHAPE, () => actions?.windowControls?.onToggleMinimize()),
          createButton("Open in new tab", OPEN_IN_TAB_SHAPE, () => actions?.windowControls?.onOpenInTab()),
        ]
      : []),
    ...(onMoveBack ? [createButton("Move back to page", MOVE_BACK_SHAPE, () => actions?.onMoveBack?.())] : []),
    createButton(closeLabel ?? "Stop typing here", CLOSE_SHAPE, () => actions?.onClose()),
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
  labelNode.data =
    indicator.state === "not-typing"
      ? "Not typing"
      : `TypeTarget ${formatElapsed(indicator.state === "stopped" ? 0 : Date.now() - indicator.since)}`;
  badge.style.background = COLOR[indicator.state];
  if (controls) controls.style.background = COLOR[indicator.state];
  setDestinationColor(COLOR[indicator.state]); // the outline always matches the label's color
  placed = ""; // the text may have changed the badge's height
  clippers = findClippers(anchor);
  place();
};

/** The element's parent, stepping out of shadow roots too. */
const parentOf = (node: Node): Element | null => {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
};

/** Ancestors that clip their contents (any `overflow` other than visible). Found by walking
 * computed styles, so it is refreshed on the timer tick rather than every frame. */
const findClippers = (el: Element): Element[] => {
  const found: Element[] = [];
  for (let node = parentOf(el); node; node = parentOf(node)) {
    // The root and body only clip to the viewport, which the badge (position: fixed) already respects.
    if (node === document.documentElement || node === document.body) continue;
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX !== "visible" || overflowY !== "visible") found.push(node);
  }
  return found;
};

type Box = { top: number; left: number; bottom: number; right: number };

/**
 * The part of the element's box the user can see: its bounding box trimmed by every clipping
 * ancestor's padding box. Chat composers often let the editor stick out past a clipping
 * container (an empty field is taller than its row), and the page only paints the outline
 * where it is not clipped, so the badge has to attach to this, not to the raw box. Null when
 * nothing is visible.
 */
const visibleBox = (el: Element): Box | null => {
  const { top, left, bottom, right } = el.getBoundingClientRect();
  const box: Box = { top, left, bottom, right };
  for (const clipper of clippers) {
    const r = clipper.getBoundingClientRect();
    const style = getComputedStyle(clipper);
    const px = (value: string) => parseFloat(value) || 0;
    box.top = Math.max(box.top, r.top + px(style.borderTopWidth));
    box.left = Math.max(box.left, r.left + px(style.borderLeftWidth));
    box.bottom = Math.min(box.bottom, r.bottom - px(style.borderBottomWidth));
    box.right = Math.min(box.right, r.right - px(style.borderRightWidth));
  }
  return box.bottom > box.top && box.right > box.left ? box : null;
};

/** Keeps the badge and its buttons sitting on the outline's top edge. Cheap enough to run every frame. */
const place = (): void => {
  if (!badge || !controls || !anchor) return;
  const rect = anchor.isConnected ? visibleBox(anchor) : null;
  if (!rect) {
    if (placed !== "hidden") {
      badge.style.display = "none";
      controls.style.display = "none";
    }
    placed = "hidden";
    return;
  }
  if (placed === "hidden" || placed === "") {
    badge.style.display = "block";
    controls.style.display = "block";
  }
  // The outline (highlight.ts) is drawn inside the element's edge, so the badge's left edge is
  // the element's own (the buttons' right edge likewise), and its bottom sits 1px inside the top
  // edge so it joins the outline's outer line. Where the element is at the top of the viewport
  // it goes inside the top edge instead.
  const edge = rect.top + 1;
  const topOf = ({ offsetHeight }: HTMLElement) => {
    const above = edge - offsetHeight;
    return `${above >= 0 ? above : edge}px`;
  };
  const top = topOf(badge);
  const left = `${Math.max(0, rect.left)}px`;
  const controlsTop = topOf(controls);
  const controlsLeft = `${Math.max(0, Math.min(rect.right, window.innerWidth) - controls.offsetWidth)}px`;
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
    badge.setAttribute("style", BASE_STYLE);
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

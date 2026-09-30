/**
 * The listening timer, drawn as a small tab sitting on top of the destination's double
 * outline (see highlight.ts), which takes on its color: green while listening, the app icon's
 * red when stopped, grey while paused or while a lost connection is being re-established. Fixed-positioned at the document root
 * rather than inserted beside the element, so the page's layout and `overflow: hidden`
 * containers can't move or clip it. It is re-placed on every animation frame, not just on
 * scroll/resize: chat boxes grow as text is typed and pages shift layout without firing
 * either, which left it floating away from the outline until the next tick. Only ever one,
 * for the one destination. Reads: state icon, the source tab's name (none when stopped), the timer.
 */
import { formatElapsed } from "../domain/elapsed";
import type { SessionIndicator } from "../domain/messages";
import { DESTINATION_COLOR, setDestinationColor } from "./highlight";

export const SESSION_BADGE_ID = "typetarget-session-badge";

const COLOR: Record<SessionIndicator["state"], string> = {
  listening: "#1f9d55",
  paused: "#6b7280",
  reconnecting: "#6b7280",
  stopped: DESTINATION_COLOR,
};

const MAX_NAME_LENGTH = 28;

/** Tab titles can be long; the badge only needs enough to recognize the tab. */
const truncate = (name: string): string => (name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…` : name);

const SVG_NS = "http://www.w3.org/2000/svg";

/** Shapes on the same 12x12 grid as the popup's icons: play while listening, pause bars when
 * paused, a cross while reconnecting, a square when stopped. The badge is only this and the timer. */
const ICON_SHAPES: Record<SessionIndicator["state"], { tag: "path" | "rect"; attrs: Record<string, string> }> = {
  listening: { tag: "path", attrs: { d: "M2 1.2 L10.5 6 L2 10.8 Z", fill: "currentColor" } },
  paused: { tag: "path", attrs: { d: "M1.5 1 H4.5 V11 H1.5 Z M7.5 1 H10.5 V11 H7.5 Z", fill: "currentColor" } },
  reconnecting: { tag: "path", attrs: { d: "M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5", stroke: "currentColor", "stroke-width": "2", fill: "none" } },
  stopped: { tag: "rect", attrs: { x: "1.5", y: "1.5", width: "9", height: "9", fill: "currentColor" } },
};

const createIcon = (state: SessionIndicator["state"]): SVGElement => {
  const shape = ICON_SHAPES[state];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("style", "display: inline-block; vertical-align: -1px; margin-right: 4px");
  const el = document.createElementNS(SVG_NS, shape.tag);
  for (const [name, value] of Object.entries(shape.attrs)) el.setAttribute(name, value);
  svg.append(el);
  return svg;
};

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

let badge: HTMLElement | null = null;
let anchor: Element | null = null;
let indicator: SessionIndicator | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let frame: number | null = null;
let clippers: Element[] = [];
/** Last position written, so the per-frame loop touches the style only when the element moved. */
let placed = "";
/** The badge's icon is rebuilt only when the state changes, not on each tick. */
let shownState: SessionIndicator["state"] | null = null;
let labelNode: Text | null = null;

const render = (): void => {
  if (!badge || !anchor || !indicator) return;
  const elapsed = indicator.state === "stopped" ? 0 : Date.now() - indicator.since;
  if (shownState !== indicator.state || !labelNode) {
    shownState = indicator.state;
    labelNode = document.createTextNode("");
    badge.replaceChildren(createIcon(indicator.state), labelNode);
  }
  const timer = formatElapsed(elapsed);
  labelNode.data = indicator.state === "stopped" ? timer : `${truncate(indicator.tabName)} ${timer}`;
  badge.style.background = COLOR[indicator.state];
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

/** Keeps the badge sitting on the outline's top edge. Cheap enough to run every frame. */
const place = (): void => {
  if (!badge || !anchor) return;
  const rect = anchor.isConnected ? visibleBox(anchor) : null;
  if (!rect) {
    if (placed !== "hidden") badge.style.display = "none";
    placed = "hidden";
    return;
  }
  if (placed === "hidden" || placed === "") badge.style.display = "block";
  const { offsetHeight } = badge;
  // The outline (highlight.ts) is drawn inside the element's edge, so the badge's left edge is
  // the element's own, and its bottom sits 1px inside the top edge so it joins the outline's
  // outer line. Where the element is at the top of the viewport it goes inside the top edge instead.
  const edge = rect.top + 1;
  const above = edge - offsetHeight;
  const top = `${above >= 0 ? above : edge}px`;
  const left = `${Math.max(0, rect.left)}px`;
  if (placed === `${top} ${left}`) return;
  placed = `${top} ${left}`;
  badge.style.top = top;
  badge.style.left = left;
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
  shownState = null;
  labelNode = null;
};

/** Shows the timer on `el`, or removes it when either argument is null. */
export const setSessionBadge = (el: Element | null, next: SessionIndicator | null): void => {
  anchor = el;
  indicator = next;
  if (!el || !next) {
    remove();
    return;
  }
  if (!badge) {
    // A badge left by an earlier injection (e.g. before the extension was reloaded) keeps its
    // old build's placement and would sit beside this one; same reason highlight.ts rewrites
    // its style element.
    document.getElementById(SESSION_BADGE_ID)?.remove();
    badge = document.createElement("div");
    badge.id = SESSION_BADGE_ID;
    badge.setAttribute("style", BASE_STYLE);
    badge.setAttribute("aria-hidden", "true");
    document.documentElement.append(badge);
    ticker = setInterval(render, 1000);
    frame = requestAnimationFrame(follow);
  }
  render();
};

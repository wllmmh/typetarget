/**
 * The listening timer, drawn as a small tab sitting on top of the destination's double
 * outline (see highlight.ts), which takes on its color: green while listening, the app icon's
 * red when stopped, grey while paused or while a lost connection is being re-established. Fixed-positioned at the document root
 * rather than inserted beside the element, so the page's layout and `overflow: hidden`
 * containers can't move or clip it; it follows the element on scroll, resize and each
 * tick. Only ever one, for the one destination. Reads: state icon, the source tab's name, the timer.
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
  labelNode.data = `${truncate(indicator.tabName)} ${formatElapsed(elapsed)}`;
  badge.style.background = COLOR[indicator.state];
  setDestinationColor(COLOR[indicator.state]); // the outline always matches the label's color
  const rect = anchor.getBoundingClientRect();
  if (!anchor.isConnected || (rect.width === 0 && rect.height === 0)) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "block";
  const { offsetHeight } = badge;
  // Above the outline, 1px up and 2px left of it; inside its top edge when the element is at the top of the viewport.
  const above = rect.top - offsetHeight - 1;
  badge.style.top = `${above >= 0 ? above : rect.top}px`;
  badge.style.left = `${Math.max(0, rect.left - 2)}px`;
};

const remove = (): void => {
  setDestinationColor(null);
  if (ticker !== null) clearInterval(ticker);
  ticker = null;
  window.removeEventListener("scroll", render, true);
  window.removeEventListener("resize", render);
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
    badge = document.createElement("div");
    badge.id = SESSION_BADGE_ID;
    badge.setAttribute("style", BASE_STYLE);
    badge.setAttribute("aria-hidden", "true");
    document.documentElement.append(badge);
    // Capture phase: scrolling any inner container moves the element too.
    window.addEventListener("scroll", render, { capture: true, passive: true });
    window.addEventListener("resize", render, { passive: true });
    ticker = setInterval(render, 1000);
  }
  render();
};

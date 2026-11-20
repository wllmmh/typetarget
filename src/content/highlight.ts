/**
 * Marks on page elements: a solid outline on the eligible element under the pointer while
 * selection mode is active, and a rounded frame, in the session's color, around the picked
 * destination for as long as it stays picked — however it was picked (selection mode or the
 * right-click menu). Each only ever marks one element and cleans up after itself.
 *
 * The hover outline is drawn inset (negative offset): chat composers typically sit inside
 * `overflow: hidden` rounded containers, which clip an outside outline down to a single visible
 * edge. The destination's frame needs room around the field, so it is not an outline but its own
 * element, fixed at the document root like the badge (session-badge.ts): no container can clip
 * it, and its corners are its own. It follows the visible part of the element every animation
 * frame. The element also gets a class, so the destination can be found in the DOM.
 */

import { findClippers, visibleBox } from "./visible-box";

const INSET_2PX = "-2px";

/** The frame's border width, the gap between it and the element, and the element corner radius
 * assumed for a square element. The frame's radius is the element's plus the reach, so the gap
 * is even all round. */
const FRAME_WIDTH_PX = 2;
const FRAME_GAP_PX = 4;
/** How far the frame's outer edge is from the element's: the badge sits beyond it. */
export const DESTINATION_REACH_PX = FRAME_WIDTH_PX + FRAME_GAP_PX;
const SQUARE_ELEMENT_RADIUS_PX = 4;

export const DESTINATION_FRAME_ID = "typetarget-destination-frame";
const DESTINATION_CLASS = "typetarget-destination";

/** The picked destination's frame color; the listening timer changes it with its state (see session-badge.ts). */
export const DESTINATION_COLOR = "#e22726";
let destinationColor = DESTINATION_COLOR;

/** Returns a setter that keeps `outline` on at most one element at a time; null removes it. */
const createMarker = (className: string, styleId: string, outline: () => string, offset: string) => {
  let current: Element | null = null;
  const writeStyle = () => {
    // Rewritten on every mark, not only created: a style left by an earlier injection of an
    // older build would otherwise keep its old color until the page is reloaded.
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.append(style);
    }
    style.textContent = `.${className} { outline: ${outline()} !important; outline-offset: ${offset} !important; }`;
  };
  const set = (el: Element | null): void => {
    if (current === el) return;
    current?.classList.remove(className);
    current = el;
    if (!el) {
      document.getElementById(styleId)?.remove();
      return;
    }
    writeStyle();
    el.classList.add(className);
  };
  return { set };
};

const candidateMarker = createMarker("typetarget-highlight-candidate", "typetarget-highlight-style", () => "2px solid #4f8ef7", INSET_2PX);
export const setHighlighted = candidateMarker.set;

export const clearHighlight = (): void => setHighlighted(null);

/** `all: initial` first, so page styles for `div` can't reshape it. Just under the badge. */
const FRAME_STYLE = [
  "all: initial",
  "position: fixed",
  "z-index: 2147483646",
  "pointer-events: none",
  "box-sizing: border-box",
  `border: ${FRAME_WIDTH_PX}px solid`,
].join("; ");

let destination: Element | null = null;
let frame: HTMLElement | null = null;
let clippers: Element[] = [];
let clippersTimer: ReturnType<typeof setInterval> | null = null;
let animation: number | null = null;
/** Last geometry written, so the per-frame loop touches the style only when the element moved. */
let placed = "";

/** The element's own corner radius (its top left one), or the assumed one if it is square. */
const elementRadius = (el: Element): number => parseFloat(getComputedStyle(el).borderTopLeftRadius) || SQUARE_ELEMENT_RADIUS_PX;

const placeFrame = (): void => {
  if (!frame || !destination) return;
  const box = destination.isConnected ? visibleBox(destination, clippers) : null;
  const key = box ? `${box.top} ${box.left} ${box.bottom} ${box.right}` : "hidden";
  if (key === placed) return;
  placed = key;
  if (!box) {
    frame.style.display = "none";
    return;
  }
  frame.style.display = "block";
  frame.style.top = `${box.top - DESTINATION_REACH_PX}px`;
  frame.style.left = `${box.left - DESTINATION_REACH_PX}px`;
  frame.style.width = `${box.right - box.left + 2 * DESTINATION_REACH_PX}px`;
  frame.style.height = `${box.bottom - box.top + 2 * DESTINATION_REACH_PX}px`;
};

const follow = (): void => {
  placeFrame();
  animation = requestAnimationFrame(follow);
};

/** Frames the element transcribed text is going to; null removes the frame. */
export const setDestinationMarker = (el: Element | null): void => {
  if (destination === el) return;
  destination?.classList.remove(DESTINATION_CLASS);
  destination = el;
  frame?.remove();
  frame = null;
  if (clippersTimer !== null) clearInterval(clippersTimer);
  clippersTimer = null;
  if (animation !== null) cancelAnimationFrame(animation);
  animation = null;
  placed = "";
  clippers = [];
  if (!el) return;
  el.classList.add(DESTINATION_CLASS);
  // One left by an earlier injection (e.g. before the extension was reloaded) has no owner left
  // to remove it; same reason session-badge.ts replaces a stale badge. Builds before the frame
  // drew an outline from a style element instead.
  document.getElementById(DESTINATION_FRAME_ID)?.remove();
  document.getElementById("typetarget-destination-style")?.remove();
  frame = document.createElement("div");
  frame.id = DESTINATION_FRAME_ID;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("style", FRAME_STYLE);
  frame.style.borderColor = destinationColor;
  frame.style.borderRadius = `${elementRadius(el) + DESTINATION_REACH_PX}px`;
  document.documentElement.append(frame);
  clippers = findClippers(el);
  // Walking computed styles is too slow for every frame; a page rarely changes its clipping.
  clippersTimer = setInterval(() => {
    if (destination) clippers = findClippers(destination);
    placed = "";
  }, 1000);
  placeFrame();
  animation = requestAnimationFrame(follow);
};

/** Recolors the destination's frame (null restores the default), e.g. grey while reconnecting. */
export const setDestinationColor = (color: string | null): void => {
  destinationColor = color ?? DESTINATION_COLOR;
  if (frame) frame.style.borderColor = destinationColor;
};

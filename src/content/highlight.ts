/**
 * Outlines on page elements: a solid one on the eligible element under the pointer while
 * selection mode is active, and a double one on the picked destination for as long as it
 * stays picked — however it was picked (selection mode or the right-click menu). Each only
 * ever marks one element and cleans up after itself; they use separate style elements so
 * ending selection mode can't strip the destination's.
 *
 * Drawn inset (negative offset): chat composers typically sit inside `overflow: hidden`
 * rounded containers, which clipped an outside outline down to a single visible edge. The
 * destination's 4px double outline is drawn entirely inside the element (offset -4px), so a
 * clipping parent flush with the element can't cut off its outer line.
 */

const INSET_2PX = "-2px";
const INSET_4PX = "-4px";

/** The picked destination's outline color; the listening timer changes it with its state (see session-badge.ts). */
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
  return { set, refresh: () => current && writeStyle() };
};

const candidateMarker = createMarker("typetarget-highlight-candidate", "typetarget-highlight-style", () => "2px solid #4f8ef7", INSET_2PX);
export const setHighlighted = candidateMarker.set;

export const clearHighlight = (): void => setHighlighted(null);

const destinationMarker = createMarker(
  "typetarget-destination",
  "typetarget-destination-style",
  () => `4px double ${destinationColor}`,
  INSET_4PX,
);

/** Double outline on the element transcribed text is going to; null removes it. */
export const setDestinationMarker = destinationMarker.set;

/** Recolors the destination's outline (null restores the default), e.g. amber while reconnecting. */
export const setDestinationColor = (color: string | null): void => {
  const next = color ?? DESTINATION_COLOR;
  if (next === destinationColor) return; // called every timer tick; don't rewrite the page's style for nothing
  destinationColor = next;
  destinationMarker.refresh();
};

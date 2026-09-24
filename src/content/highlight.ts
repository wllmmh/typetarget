/**
 * Outlines on page elements: a solid one on the eligible element under the pointer while
 * selection mode is active, and a dashed one on the picked destination for as long as it
 * stays picked — however it was picked (selection mode or the right-click menu). Each only
 * ever marks one element and cleans up after itself; they use separate style elements so
 * ending selection mode can't strip the destination's.
 *
 * Drawn inset (negative offset): chat composers typically sit inside `overflow: hidden`
 * rounded containers, which clipped an outside outline down to a single visible edge.
 */

const OUTLINE_OFFSET = "-2px";

/** Returns a setter that keeps `outline` on at most one element at a time; null removes it. */
const createMarker = (className: string, styleId: string, outline: string) => {
  let current: Element | null = null;
  return (el: Element | null): void => {
    if (current === el) return;
    current?.classList.remove(className);
    current = el;
    if (!el) {
      document.getElementById(styleId)?.remove();
      return;
    }
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `.${className} { outline: ${outline} !important; outline-offset: ${OUTLINE_OFFSET} !important; }`;
      document.head.append(style);
    }
    el.classList.add(className);
  };
};

export const setHighlighted = createMarker("typetarget-highlight-candidate", "typetarget-highlight-style", "2px solid #4f8ef7");

export const clearHighlight = (): void => setHighlighted(null);

/** Dashed outline on the element transcribed text is going to; null removes it. */
export const setDestinationMarker = createMarker("typetarget-destination", "typetarget-destination-style", "2px dashed #4f8ef7");

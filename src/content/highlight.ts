/**
 * Temporary visual outline on the currently-hovered eligible element while selection
 * mode is active. Per AGENTS.md: "Do not permanently highlight page elements" — this
 * module only ever outlines one element at a time and always cleans up on exit.
 */

const HIGHLIGHT_CLASS = "wavetype-highlight-candidate";
const STYLE_ELEMENT_ID = "wavetype-highlight-style";

const ensureStyleInjected = () => {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 2px solid #4f8ef7 !important;
      outline-offset: 1px !important;
    }
  `;
  document.head.append(style);
};

let currentlyHighlighted: Element | null = null;

export const setHighlighted = (el: Element | null): void => {
  if (currentlyHighlighted === el) return;
  currentlyHighlighted?.classList.remove(HIGHLIGHT_CLASS);
  currentlyHighlighted = el;
  if (el) {
    ensureStyleInjected();
    el.classList.add(HIGHLIGHT_CLASS);
  }
};

export const clearHighlight = (): void => {
  setHighlighted(null);
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
};

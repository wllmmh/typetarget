/**
 * Where a page element can be seen: the badge and the destination's frame (session-badge.ts,
 * highlight.ts) are drawn at the document root, position: fixed, so they attach to this rather
 * than to the element's raw box.
 */

/** The element's parent, stepping out of shadow roots too. */
const parentOf = (node: Node): Element | null => {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
};

/** Ancestors that clip their contents (any `overflow` other than visible). Found by walking
 * computed styles, so it is refreshed on the timer tick rather than every frame. */
export const findClippers = (el: Element): Element[] => {
  const found: Element[] = [];
  for (let node = parentOf(el); node; node = parentOf(node)) {
    // The root and body only clip to the viewport, which the badge and frame (position: fixed) already respect.
    if (node === document.documentElement || node === document.body) continue;
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX !== "visible" || overflowY !== "visible") found.push(node);
  }
  return found;
};

export type Box = { top: number; left: number; bottom: number; right: number };

/**
 * The part of the element's box the user can see: its bounding box trimmed by every clipping
 * ancestor's padding box. Chat composers often let the editor stick out past a clipping
 * container (an empty field is taller than its row), so the frame and badge attach to this,
 * not to the raw box. Null when nothing is visible.
 */
export const visibleBox = (el: Element, clippers: readonly Element[]): Box | null => {
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

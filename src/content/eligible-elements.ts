/** Determines which elements are valid transcript destinations. */

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "", // <input> with no type attribute defaults to text
]);

/**
 * `isContentEditable` correctly accounts for `contenteditable="false"` on a nested
 * ancestor overriding an editable one further up, which a raw attribute check would
 * miss — real Chrome always returns a boolean here. jsdom (used in this project's
 * unit tests) doesn't implement the property at all, only the attribute, so this
 * falls back to the attribute for that environment; this only ever activates under
 * jsdom, never in the shipped extension.
 */
export const isContentEditableElement = (el: HTMLElement): boolean =>
  typeof el.isContentEditable === "boolean" ? el.isContentEditable : el.getAttribute("contenteditable") === "true";

export const isEligibleDestination = (el: Element): el is HTMLElement => {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(el.type) && !el.disabled && !el.readOnly;
  }
  if (el instanceof HTMLElement && isContentEditableElement(el)) return true;
  return false;
};

/** Walks up from an event target to the nearest eligible destination, if any. */
export const findEligibleAncestor = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Element)) return null;
  let current: Element | null = target;
  while (current) {
    if (isEligibleDestination(current)) return current;
    current = current.parentElement;
  }
  return null;
};

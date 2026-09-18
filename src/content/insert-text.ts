/**
 * Inserts finalized transcript text into the destination element. Two separate
 * paths per AGENTS.md "Destination implementation":
 *  - textarea/input: write through the native value setter (bypassing any
 *    framework-patched setter on the instance) so React/Vue/Angular controlled
 *    inputs notice the change, then dispatch `input`/`change`.
 *  - contenteditable: a separate DOM-mutation path; no `document.execCommand`.
 *
 * Insertion is boundary-based, not "overwrite the whole field": each element gets an
 * internal insertion offset (see insertion-boundary.ts) that only ever advances by
 * what this module just inserted, so concurrent user edits elsewhere in the field are
 * never clobbered by re-reading a stale full value.
 */
import { isContentEditableElement } from "./eligible-elements";

const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  "value",
)?.set;
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

const dispatchInputEvents = (el: Element) => {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

/**
 * Inserts `text` at `atOffset` in a text input/textarea's current value, moving the
 * caret to just after the inserted text, and returns the new caret offset (the
 * caller's next insertion boundary).
 */
const insertIntoTextField = (el: HTMLInputElement | HTMLTextAreaElement, text: string, atOffset: number): number => {
  const setter = el instanceof HTMLTextAreaElement ? nativeTextareaValueSetter : nativeInputValueSetter;
  const currentValue = el.value;
  const safeOffset = Math.min(atOffset, currentValue.length);
  const nextValue = currentValue.slice(0, safeOffset) + text + currentValue.slice(safeOffset);

  if (setter) {
    setter.call(el, nextValue);
  } else {
    // Fallback if the prototype setter is ever unavailable; still correct, just
    // more likely to be missed by a framework's own patched setter.
    el.value = nextValue;
  }

  const newOffset = safeOffset + text.length;
  el.setSelectionRange(newOffset, newOffset);
  dispatchInputEvents(el);
  return newOffset;
};

/** Inserts `text` at a contenteditable element's stored boundary using a Range, not execCommand. */
const insertIntoContentEditable = (el: HTMLElement, text: string): void => {
  const selection = window.getSelection();
  const range = document.createRange();

  // Always insert at the end of the element's content. Tracking a precise DOM
  // offset boundary across contenteditable's mutable node tree (text nodes can
  // split/merge under the user's own edits) is materially harder than for a plain
  // input's string value; anchoring to "end of content" is documented as the V1
  // behavior here and is the append semantics AGENTS.md's insertion-semantics
  // section asks for, without touching whatever the user typed before it.
  range.selectNodeContents(el);
  range.collapse(false);

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);

  selection?.removeAllRanges();
  selection?.addRange(range);

  el.dispatchEvent(new Event("input", { bubbles: true }));
};

export type InsertionTarget =
  | { kind: "text-field"; element: HTMLInputElement | HTMLTextAreaElement }
  | { kind: "content-editable"; element: HTMLElement };

/**
 * Inserts text with a separator, per AGENTS.md "Transcript insertion semantics":
 * append at the tracked boundary, never overwrite existing content. Returns the new
 * boundary offset for text-field targets (meaningless/unused for contenteditable).
 */
export const insertTranscriptText = (target: InsertionTarget, text: string, separator: string, atOffset: number): number => {
  const combined = atOffset === 0 ? text : separator + text;
  if (target.kind === "text-field") {
    return insertIntoTextField(target.element, combined, atOffset);
  }
  insertIntoContentEditable(target.element, combined);
  return atOffset + combined.length;
};

export const toInsertionTarget = (el: HTMLElement): InsertionTarget | null => {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return { kind: "text-field", element: el };
  }
  if (isContentEditableElement(el)) return { kind: "content-editable", element: el };
  return null;
};

/**
 * Inserts finalized transcript text into the destination element. Two paths:
 *  - textarea/input: write through the native value setter (bypassing any
 *    framework-patched setter on the instance) so React/Vue/Angular controlled
 *    inputs notice the change, then dispatch `input`/`change`.
 *  - contenteditable: the browser's own `insertText` editing command, so rich-text
 *    editors (ProseMirror, Lexical, Slate...) see a native beforeinput/input and update
 *    their model; a bare DOM mutation gets reverted by editors like Lexical. The DOM path
 *    stays as a fallback (docs/adr/0011-contenteditable-insertion-through-execcommand.md).
 *
 * Insertion is boundary-based, not "overwrite the whole field": the caller tracks an
 * insertion offset (see destination-session.ts) that only ever advances by what this
 * module inserted, so the user's own edits elsewhere in the field are never clobbered.
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
 * Inserts `text` at `atOffset` in a text input/textarea's current value and returns
 * the offset just after it (the caller's next insertion boundary). The user's
 * selection is kept where it was: positions before the insertion point stay put,
 * positions at or after it shift by the inserted length (so a caret sitting at the
 * boundary keeps following the transcript).
 */
const insertIntoTextField = (el: HTMLInputElement | HTMLTextAreaElement, text: string, atOffset: number): number => {
  const setter = el instanceof HTMLTextAreaElement ? nativeTextareaValueSetter : nativeInputValueSetter;
  const currentValue = el.value;
  const safeOffset = Math.min(atOffset, currentValue.length);
  const nextValue = currentValue.slice(0, safeOffset) + text + currentValue.slice(safeOffset);
  const { selectionStart, selectionEnd, selectionDirection, scrollTop, scrollLeft } = el;
  const shift = (position: number) => (position >= safeOffset ? position + text.length : position);

  if (setter) {
    setter.call(el, nextValue);
  } else {
    // Fallback if the prototype setter is ever unavailable; still correct, just
    // more likely to be missed by a framework's own patched setter.
    el.value = nextValue;
  }

  const newOffset = safeOffset + text.length;
  // selectionStart is null for input types without a selection API (e.g. email).
  if (selectionStart !== null && selectionEnd !== null) {
    el.setSelectionRange(shift(selectionStart), shift(selectionEnd), selectionDirection ?? undefined);
    // Replacing the value can scroll the field; keep the user's view when they're editing above the boundary.
    if (selectionEnd < safeOffset) {
      el.scrollTop = scrollTop;
      el.scrollLeft = scrollLeft;
    }
  }
  dispatchInputEvents(el);
  return newOffset;
};

/**
 * The user's selection inside `el`, if it's somewhere other than the very end of its
 * content (a caret at the end should keep following the transcript, so it isn't saved).
 * Ranges are live, so the clone tracks the DOM changes the insertion makes.
 */
const saveSelectionAwayFromEnd = (el: HTMLElement): Range | null => {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;
  const afterSelection = document.createRange();
  afterSelection.setStart(range.endContainer, range.endOffset);
  afterSelection.setEnd(el, el.childNodes.length);
  return afterSelection.toString() === "" ? null : range.cloneRange();
};

/**
 * Inserts `text` at the end of a contenteditable through the native editing pipeline. The
 * command acts on the focused element's selection, so the element is focused for the
 * insertion and whatever had focus in this document before gets it back afterwards, and a
 * selection the user had elsewhere in the element is put back.
 */
const insertIntoContentEditable = (el: HTMLElement, text: string): void => {
  const previouslyFocused = document.activeElement;
  const userSelection = saveSelectionAwayFromEnd(el);
  el.focus({ preventScroll: true });
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  // Deprecated but still the only standard way to drive native editing; returns false when
  // the command is unsupported (e.g. jsdom) or the selection isn't editable.
  const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!inserted) insertWithDomRange(el, text);
  if (userSelection) {
    selection?.removeAllRanges();
    selection?.addRange(userSelection);
  }
  if (previouslyFocused instanceof HTMLElement && previouslyFocused !== el) previouslyFocused.focus({ preventScroll: true });
};

/** Fallback: a plain DOM insertion. Fine for bare contenteditables; framework editors may revert it. */
const insertWithDomRange = (el: HTMLElement, text: string): void => {
  const selection = window.getSelection();
  const range = document.createRange();

  // Always insert at the end of the element's content. Tracking a precise DOM offset
  // across contenteditable's mutable node tree (text nodes split and merge under the
  // user's own edits) is much harder than for an input's string value, and appending
  // leaves whatever the user typed before it untouched.
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
 * Inserts text at the tracked boundary, preceded by `separator` unless the boundary is at
 * the very start; never overwrites existing content. Returns the new boundary offset
 * (meaningless for contenteditable, which always appends).
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

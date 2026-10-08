/**
 * The text box opened by the right-click menu's "Type to new file": fixed over the bottom
 * third of the viewport, so it can be picked as the output on a page that has no text box of
 * its own. It only exists while it is the output — destination-session.ts removes it when the
 * output is cleared (the badge's X, or Stop typing) or moved to another box. Its text is kept
 * with the badge's Save button, like any other output's.
 */

export const NEW_FILE_FIELD_ID = "typetarget-new-file-field";

/** `all: initial` first, so page styles for `textarea` can't reshape it. System colors follow
 * the user's light/dark preference rather than the page's. */
const STYLE = [
  "all: initial",
  "position: fixed",
  "left: 0",
  "bottom: 0",
  "width: 100%",
  "height: calc(100% / 3)",
  "z-index: 2147483646", // just under the badge, which sits on its top edge
  "box-sizing: border-box",
  "padding: 12px 16px",
  "resize: none",
  "overflow: auto",
  "white-space: pre-wrap",
  "color-scheme: light dark",
  "background: Canvas",
  "color: CanvasText",
  "font: 15px/1.5 system-ui, sans-serif",
  "box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.25)",
].join("; ");

export const createNewFileField = (): HTMLTextAreaElement => {
  // One left by an earlier injection (e.g. before the extension was reloaded) has no owner left
  // to close it; same reason session-badge.ts replaces a stale badge.
  document.getElementById(NEW_FILE_FIELD_ID)?.remove();
  const field = document.createElement("textarea");
  field.id = NEW_FILE_FIELD_ID;
  field.setAttribute("style", STYLE);
  field.setAttribute("aria-label", "TypeTarget new file");
  field.placeholder = "Transcribed text appears here. You can type here too.";
  field.spellcheck = true;
  document.documentElement.append(field);
  return field;
};

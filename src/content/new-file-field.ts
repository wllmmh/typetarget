/**
 * The text box opened by the right-click menu's "Type to new file": fixed over the bottom
 * third of the viewport, so it can be picked as the output on a page that has no text box of
 * its own. destination-session.ts removes it when the badge's X is clicked or the output moves
 * to another box; Stop typing leaves it on the page with its text, no longer typed into, until
 * its X is clicked. Its text is kept
 * with the badge's Save button, like any other output's. The badge also offers Minimize (down to
 * one line at the bottom of the viewport) and Open in new tab, for this box only.
 */

import { t } from "../domain/i18n";

export const NEW_FILE_FIELD_ID = "typetarget-new-file-field";

const MARGIN = "12px";
const LINE_HEIGHT = 1.5;
const PADDING_Y_PX = 12;
/** The text is 15px in a 640x400 viewport and grows with the viewport from there, so it takes
 * the same share of the box as in the landing page's step 3 animation. The smaller of the two
 * ratios keeps it from outgrowing the box in a very wide or very short window. */
const FONT_SIZE = "max(15px, 15 * min(100vw / 640, 100vh / 400))";

const OPEN_HEIGHT = "calc(100% / 3)";
/** One line of text plus the padding: what stays of the box while minimized. */
const MINIMIZED_HEIGHT = `calc(${LINE_HEIGHT}em + ${2 * PADDING_Y_PX}px)`;

/** `all: initial` first, so page styles for `textarea` can't reshape it. System colors follow
 * the user's light/dark preference rather than the page's. */
const STYLE = [
  "all: initial",
  "position: fixed",
  `left: ${MARGIN}`,
  `bottom: ${MARGIN}`,
  `width: calc(100% - 2 * ${MARGIN})`,
  `height: ${OPEN_HEIGHT}`,
  "z-index: 2147483646", // just under the badge, which sits on its top edge
  "box-sizing: border-box",
  `padding: ${PADDING_Y_PX}px 16px`,
  "border-radius: 4px",
  "resize: none",
  "overflow: auto",
  "white-space: pre-wrap",
  "color-scheme: light dark",
  "background: Canvas",
  "color: CanvasText",
  `font: ${FONT_SIZE}/${LINE_HEIGHT} system-ui, sans-serif`,
  "box-shadow: 0 0 16px rgba(0, 0, 0, 0.25)",
].join("; ");

export const createNewFileField = (): HTMLTextAreaElement => {
  // One left by an earlier injection (e.g. before the extension was reloaded) has no owner left
  // to close it; same reason session-badge.ts replaces a stale badge.
  document.getElementById(NEW_FILE_FIELD_ID)?.remove();
  const field = document.createElement("textarea");
  field.id = NEW_FILE_FIELD_ID;
  field.setAttribute("style", STYLE);
  field.setAttribute("aria-label", t("newFileLabel"));
  field.placeholder = t("transcriptPlaceholder");
  field.spellcheck = true;
  document.documentElement.append(field);
  return field;
};

/** Shrinks the box to its last line (scrolled there, so the newest text shows) or restores it. */
export const setNewFileFieldMinimized = (field: HTMLTextAreaElement, minimized: boolean): void => {
  field.style.height = minimized ? MINIMIZED_HEIGHT : OPEN_HEIGHT;
  field.scrollTop = field.scrollHeight;
};

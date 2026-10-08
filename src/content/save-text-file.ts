/**
 * The badge's Save button: downloads the output box's text as a .txt file. Done in the page
 * with a blob link rather than chrome.downloads, which would need a new permission (and an
 * install warning) for what a plain `<a download>` already does.
 */

/** Long enough for Chrome to have started the download before the blob URL goes away. */
const REVOKE_DELAY_MS = 10_000;

const pad = (n: number) => String(n).padStart(2, "0");

const MAX_TAB_NAME_LENGTH = 50;

/** A tab title as a file-name part: no path/reserved characters, whitespace collapsed, capped. */
const fileNamePart = (tabName: string): string =>
  tabName
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAB_NAME_LENGTH)
    .trim();

/**
 * e.g. typetarget-2026-10-08-1730.txt in local time, or with the source tab's title,
 * typetarget-My Video-2026-10-08-1730.txt. A title with nothing usable in it is left out.
 */
export const textFileName = (date: Date, tabName?: string): string => {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const name = tabName ? fileNamePart(tabName) : "";
  return `typetarget-${name ? `${name}-` : ""}${stamp}.txt`;
};

/**
 * The text a box holds. `innerText` keeps a rich editor's line breaks, which `textContent`
 * drops; jsdom (unit tests only) doesn't implement it, hence the fallback.
 */
export const textOf = (el: HTMLElement): string => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return typeof el.innerText === "string" ? el.innerText : el.textContent ?? "";
};

export const saveTextFile = (text: string, tabName?: string, now: Date = new Date()): void => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = textFileName(now, tabName);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

/**
 * The badge's Save button: downloads the output box's text as a .txt file. Done in the page
 * with a blob link rather than chrome.downloads, which would need a new permission (and an
 * install warning) for what a plain `<a download>` already does.
 */

/** Long enough for Chrome to have started the download before the blob URL goes away. */
const REVOKE_DELAY_MS = 10_000;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * e.g. TypeTarget-2026-10-08T17-30-05.txt (ISO 8601 in local time, with "-" for ":" since
 * Windows file names can't hold colons). The source tab's title is left out: the content script
 * never receives it (see SessionIndicator).
 */
export const textFileName = (date: Date): string => {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `TypeTarget-${day}T${time}.txt`;
};

/**
 * The text a box holds. `innerText` keeps a rich editor's line breaks, which `textContent`
 * drops; jsdom (unit tests only) doesn't implement it, hence the fallback.
 */
export const textOf = (el: HTMLElement): string => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return typeof el.innerText === "string" ? el.innerText : el.textContent ?? "";
};

export const saveTextFile = (text: string, now: Date = new Date()): void => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = textFileName(now);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

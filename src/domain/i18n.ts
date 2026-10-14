/**
 * UI text in the browser's display language. The strings live in `_locales/<lang>/messages.json`,
 * and Chrome picks the language the browser's own UI is in, falling back to English
 * (`default_locale`) for a language or a message it doesn't have. The preferred languages for
 * pages (Settings → Languages) don't affect it. Keys are typed from the English file, so a
 * misspelled key is a type error rather than an empty label.
 *
 * Works in extension pages, the service worker and content scripts, but not in the ASR worker,
 * which has no `chrome.i18n`.
 */
export type MessageKey = keyof typeof import("../../_locales/en/messages.json");

/** `substitutions` fill the message's placeholders in order ($1, $2…). */
export const t = (key: MessageKey, ...substitutions: (string | number)[]): string =>
  chrome.i18n.getMessage(key, substitutions.map(String));

# 0015. UI text in the browser's display language, through chrome.i18n
- Status: Accepted
- Date: 2026-10-14

## Context

All of TypeTarget's UI text was English, hard-coded where it is shown: the popup (React), the
right-click menu (service worker), the badge buttons and new-file box (content script, in the
destination page) and the editor tab. Users whose browser runs in another language should see
those labels in it.

A browser has two language settings: the display language its own UI is in, and the preferred
languages it asks websites for (`navigator.languages`, Settings → Languages). TypeTarget's UI is
part of the browser's UI, so it should match the first.

## Decision

Use Chrome's own extension i18n:

- **Strings live in `_locales/<lang>/messages.json`,** with `default_locale: "en"` in the
  manifest. crxjs copies the folder into `dist/`. The manifest's name and description use
  `__MSG_extName__` and `__MSG_extDescription__`.
- **Chrome picks the language:** the display language, falling back to English for a language
  or a single message it doesn't have. The preferred languages for pages don't affect it, and
  there is no in-app language setting.
- **`t(key, ...substitutions)` in `src/domain/i18n.ts`** wraps `chrome.i18n.getMessage`. Its keys
  are typed from the English file, so a misspelled key fails the typecheck. It works in the
  popup, editor tab, service worker and content scripts, which covers every place UI text is
  shown. Pages set `<html lang>` from `chrome.i18n.getUILanguage()`.
- **Each locale says which way it is written** (`textDirection`: `ltr` or `rtl`), and the popup
  and editor tab set `<html dir>` from it. Chrome's `@@bidi_dir` would follow the display
  language even where TypeTarget has no translation, laying English out right to left for, say,
  a Persian browser. Popup CSS uses logical properties (`inset-inline-end`, `text-align: start`)
  so it mirrors. Text that comes from elsewhere (tab titles, the destination's name, the editor's
  transcript) takes `dir="auto"`, since it is usually in another language than the UI.
- **Brand and product names stay as they are:** "TypeTarget", model names such as "Whisper
  Tiny Q5", and provider names (Google, Groq). The model menu's "Local" heading is a word, so
  it is translated.
- **Error messages stay in English.** Most are built in the background or the ASR worker, which
  has no `chrome.i18n`, and many wrap Chrome's or a provider's own text.
- **`src/domain/i18n.test.ts` checks every locale** against English: the same keys, the same
  placeholders, and the manifest's length limits. Chrome would otherwise fall back to English
  for a missing message without any sign.

## Consequences

- TypeTarget is always in the same language as the browser around it, including its name in
  the browser's menus.
- On Linux the display language comes from the desktop session's `LANGUAGE` and `LANG`, not
  from a browser setting. KDE and GNOME apply a language change at the next login, so
  restarting the browser alone leaves it, and TypeTarget, in the old language. Windows browsers
  have a "Display in this language" setting instead; macOS uses the system language.
- No new dependency, and nothing new is web-accessible: content scripts read messages through
  `chrome.i18n`, not by fetching a file
  ([ADR 0012](0012-websites-cannot-detect-typetarget.md)). The badge's text is in the user's
  language, which a page can learn from `navigator.language` anyway.
- The badge on the page stays left to right in every language: it is placed against the
  destination's own edges, and its text is "TypeTarget" and a timer. Its buttons' tooltips are
  translated.
- `chrome.i18n` has no plural rules, so counts in Diagnostics are phrased as "label: number" in
  languages where a plural would read badly.
- Tests see English: `src/test/fake-chrome.ts` fakes `chrome.i18n` over the English file, and
  `src/test/setup.ts` installs it for tests that install no fake `chrome` of their own.
- A new UI string needs a key in every locale file, or the catalogue test fails.
- The translations were machine-written and need review by native speakers (TODO.md).

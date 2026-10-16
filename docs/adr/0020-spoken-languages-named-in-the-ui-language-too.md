# 0020. Spoken languages are named in the UI's language as well as their own
- Status: Accepted
- Date: 2026-10-16

## Context

[ADR 0016](0016-transcription-detects-the-spoken-language.md) listed each language in the
Spoken language menu by its own name only (Español, 日本語), in English collation, the same in
every UI language. That helps a speaker who looks for the name they write, but not a user who
knows the language only by its name in theirs: an English reader looking for Georgian or Khmer
can't find ქართული or ខ្មែរ.

## Decision

Each row shows the language's name in the UI's language, with its own name right-aligned beside
it, like a model's size in the model menu: "Spanish   Español". Where the two are the same
(English in an English UI) the name is shown once. The trigger shows only the first name, as
the model menu's shows only the model.

- **The first name comes from `Intl.DisplayNames` at run time**, not a table per UI language
  (26 × 97 names). Chrome's ICU data has a name for every listed language in each of
  TypeTarget's UI languages (checked against CLDR 47). A language it has no name for is listed
  by its own name alone. The own names stay the fixed table from ADR 0016.
- **The UI language is the catalogue Chrome picked**, read from a `locale` message in each
  `_locales` file, not `getUILanguage()`. A browser in a language TypeTarget has no translation
  for gets an English popup, and its menu names languages in English to match. This is the same
  reasoning as `textDirection` in [ADR 0015](0015-ui-text-in-the-browsers-language.md).
- **CLDR's names are capitalized** for a menu: many locales write them in lowercase (español,
  français), as in running text.
- **The menu is sorted by the first name, in the UI language's collation**, so a reader finds a
  language under the word they know it by. This replaces ADR 0016's fixed English order.
- The own name keeps `lang` set to its code, for screen readers and font choice. Its row puts it
  at the end of the line, which is the left in a right-to-left UI.

## Consequences

- The menu's order now differs between UI languages.
- CLDR names Tagalog (`tl`) "Filipino", so an English row reads "Filipino   Tagalog".
- A screen reader reads a row as both names in turn, each in its own language.
- Each locale file has a `locale` message, which `src/domain/i18n.test.ts` checks against the
  folder name.

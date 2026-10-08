# 0011. Contenteditable insertion through `execCommand("insertText")`
- Status: Accepted
- Date: 2026-09-24

## Context

Rich-text editors (Lexical, ProseMirror, Slate) keep their own document model and reconcile
the DOM against it. A bare DOM insertion (a `Range` plus a text node plus a synthetic `input`
event) was silently reverted by Lexical, while the popup still counted it as inserted (see
[the postmortem](../postmortems/2026-09-24-lexical-reverted-inserted-text.md)).

## Decision

Insert into contenteditables with `document.execCommand("insertText")`, which drives the
browser's native editing pipeline, so editors see a real `beforeinput`/`input`. The command
acts on the focused element's selection, so the element is focused for the insertion, the
caret is moved to the end, and both focus and any selection the user had elsewhere in the
element are restored afterwards. The bare DOM insertion remains as a fallback when the command
is refused. Text inputs and textareas keep a separate path: the native value setter plus
`input`/`change` events.

## Consequences

- Verified with the real Lexical, ProseMirror and React-controlled textareas in a Playwright
  harness.
- `execCommand` is deprecated but still the only standard way to drive native editing.
- Insertion in a genuinely hidden tab is unverified, because headless Chrome reports
  background tabs as visible.

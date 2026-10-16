# 0019. Errors about the output are translated and shown beside "Typing to"
- Status: Accepted
- Date: 2026-10-16

## Context

[ADR 0015](0015-ui-text-in-the-browsers-language.md) left error messages in English, because
most are built where `chrome.i18n` is missing (the ASR worker) or wrap a provider's own text.
The errors about the output (the text box being typed into) are different: they are all built in
the service worker or the content script, which have `chrome.i18n`. Most wrapped Chrome's reason
in parentheses, which made them too long to sit anywhere but on a line of their own at the
popup's foot, far from the Typing to section they are about. The Model and Listening to headings
already show their errors beside the heading.

## Decision

- **Output errors are translated where they are built,** through `t()`, in the service worker
  (`destination-controller.ts`, `service-worker.ts`) and the content script (`bridge.ts`).
  They are short, since they sit beside a heading.
- **Chrome's own reason moves to `lastError.detail`,** shown as the error's tooltip. It is
  English and often technical ("Cannot access a chrome:// URL"), but it is what says why a page
  is out of reach.
- **The popup shows them beside "Typing to"** and leaves them out of the foot. They are told
  apart by `OUTPUT_ERROR_CODES` in `domain/messages.ts`. Start typing's own refusal (no tab)
  comes back in its reply and is shown there too, no longer under Listening to.
- The two fallbacks for an unexpected failure share a new code, `output-failed`, instead of
  `unknown`, so they count as output errors.

## Consequences

- Every error about typing is in the user's language and next to the control it concerns.
- Other errors (capture, model loading, providers) are still English and still at the foot.
- An error's text is fixed in the language the browser had when it happened. `lastError` is not
  persisted, so this lasts only until the next error or a service-worker restart.
- A new output error needs its code in `OUTPUT_ERROR_CODES`, or it shows at the foot.

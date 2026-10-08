# 0008. The source tab is the tab TypeTarget was invoked on
- Status: Accepted
- Date: 2026-09-30

## Context

Two Chrome constraints shape which tabs can be listened to:

- `tabCapture.getMediaStreamId({ targetTabId })` only accepts a tab for which the extension
  holds an `activeTab` grant. That grant comes from the user invoking the extension on the
  tab, through the toolbar button or a context-menu item.
- Without the `tabs` permission, `chrome.tabs.query({})` returns only `{id, audible}`, with no
  titles. Adding `tabs` would fix the labels but leave capture broken for every tab that
  lacks a grant.

An earlier popup offered a dropdown of every open tab. Most entries were "Untitled tab" and
could not actually be captured.

## Decision

- TypeTarget records each tab it is invoked on (`src/background/known-tabs.ts`, at most 10).
- The source is whichever tab the popup was opened on while idle (`register-active-tab`), or
  the tab where "Listen to this tab" was chosen from the right-click menu. The popup has no
  tab picker, and Stop clears the source.
- Titles follow the page through `chrome.tabs.onUpdated` while TypeTarget can still read the
  tab.

## Consequences

- No `tabs` permission and no broad host permissions are needed.
- A popup opened on the chat tab makes the chat tab the source. Users start from the tab
  that is playing audio.
- After a full navigation the `activeTab` grant is gone, so titles stop updating, and capture
  needs the toolbar button or menu again.
- The `set-source-tab` message is no longer sent by the UI.

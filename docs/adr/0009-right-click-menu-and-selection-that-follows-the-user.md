# 0009. Right-click menu, and selection that follows the user across tabs
- Status: Accepted
- Date: 2026-09-24

## Context

"Select field" injects the picker through `activeTab`, which only covers the tab the popup was
opened in. Users naturally click it on the source tab and then click a text box in another
tab, where nothing happened (see
[the postmortem](../postmortems/2026-09-24-select-field-did-nothing-in-other-tabs.md)). An
all-sites host permission would fix that, but at the cost of a broad install warning.

## Decision

- Add a "TypeTarget" right-click submenu (`contextMenus`, which has no install warning).
  Choosing an item grants `activeTab` for its tab. The items are Listen to this tab, Stop
  listening, Type to this field, Type to new file and Stop typing
  (`src/background/context-menu.ts`).
- Type to this field injects into only the clicked frame and picks `document.activeElement`,
  since right-clicking a text box focuses it.
- While a pick started from the popup is in progress, selection follows the user:
  `tabs.onActivated` and `windows.onFocusChanged` call `DestinationController.followTo`. That
  injects into the newly active tab if TypeTarget can reach it, and the injection attempt is
  itself the access check. An unreachable tab gets a popup error that points at the
  right-click menu.
- Chrome cannot say which element a menu opens on, and on Linux it opens the menu on
  mousedown, too early to retitle it. So the destination's frame reports pointer enter and
  leave (`pointer-over-destination`), and the menu greys out Type to this field on the box
  that is already the output.

## Consequences

- The output can be picked in any tab without new permissions.
- The menu is always fully listed, with items greyed out rather than hidden, so its shape
  does not depend on state Chrome cannot report at open time.
- How `activeTab` survives tab switches has been tested only with host permissions standing in
  for it, not with real grants.

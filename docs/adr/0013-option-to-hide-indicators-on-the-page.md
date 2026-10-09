# 0013. Option to hide TypeTarget's indicators on the page
- Status: Accepted
- Date: 2026-10-08

## Context

[ADR 0012](0012-websites-cannot-detect-typetarget.md) stops websites from detecting TypeTarget on
pages it isn't used on. A page it *is* used on can still see it, because TypeTarget draws in that
page's DOM: a `<style>` element and a class for the outline on the picked field, the badge with
its timer and buttons, and a hover highlight while picking. Some users want TypeTarget hidden
from the site they type into as well.

The indicators exist for a reason. They show where text is going, so a user doesn't forget which
field is the output and leak transcript text into the wrong box, and they carry the Save, Stop
typing and window buttons.

## Decision

Add a popup setting, **Show outline**, on by default and stored in
`storage.local` (`showPageIndicators`).

With it off:

- **Nothing is drawn on the page's own text boxes:** no outline, badge, buttons or hover
  highlight. The background sends the setting with every message that can lead to a pick
  (`enter-selection-mode`, `pick-focused-element`), so the content script knows it before
  drawing anything. A change applies at once to the current output and to tabs still picking
  (`set-page-indicators`).
- **The toolbar icon shows the state instead,** using `chrome.action` badge text, which pages
  can't see: "REC" in green while capturing into an output, "II" or "..." in grey while paused
  or reconnecting, and nothing otherwise. It needs no new permission.
- **"Type to new file" opens an editor tab** instead of adding a box to the page. The editor tab
  shows no "Move back to page", and a Move back from an editor opened earlier is refused with a
  message, since it would put the box on the page.
- **Exceptions:**
  - A "Type to new file" box already on the page keeps its outline and buttons. It is
    TypeTarget's own element and visible anyway, and its X is the only way to close it.
  - The editor tab ignores the setting, since websites can't see an extension page
    (`installContentBridge(..., { alwaysShowIndicators: true })`).

## Consequences

- **This lowers detection; it doesn't prevent it.** The page still sees the text arrive: input
  events with no key presses before them, in sentence-sized pieces at speaking pace. Most pages
  don't look. Sites with keystroke analytics or bot detection could notice, though dictation and
  paste look much the same. While picking with "Select field", the page's own click handler on
  the chosen field doesn't run, because TypeTarget's capturing listener takes the click. The
  right-click menu's "Type to this field" avoids that.
- **Users can lose track of the output.** The popup and the toolbar badge are the only signs, and
  Stop typing is only in the popup and the right-click menu. Save as .txt has no control at all
  in this mode. The setting is opt-in for this reason, and the popup explains it when it is off.
- **The toolbar badge is global,** not per tab, so it shows in every window.

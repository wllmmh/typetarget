# 0012. Websites cannot detect TypeTarget
- Status: Accepted
- Date: 2026-10-08

## Context

TypeTarget should be invisible to websites. A site that can tell whether an extension is
installed gets a fingerprinting signal, and learns something about the user. The
[privacy audit](../privacy-audit.md) found two ways a page could detect TypeTarget or learn
about its use:

- **Probing a web-accessible file.** `@crxjs/vite-plugin` lists the dynamically injected
  content script (`src/content/main.js`) in `web_accessible_resources` for every http(s) site,
  with `use_dynamic_url: false`. Any page could fetch
  `chrome-extension://<id>/src/content/main.js`. The extension id is public once it is in the
  Web Store, so a successful fetch means TypeTarget is installed. crx adds the entry whatever
  the manifest says: `defineDynamicResource` only chooses its `matches` and `use_dynamic_url`.
- **Reading the badge.** The listening badge is in the destination page's DOM, and its label
  named the source tab. A page the user typed into could read which video or meeting they were
  listening to in another tab.

`use_dynamic_url: true` would only make the probe URL change every session. The file doesn't
need to be web-accessible at all. The content script is built as one self-contained IIFE, with
no imports and no `chrome.runtime.getURL`, and `chrome.scripting.executeScript({ files })`
reads it from the extension package directly. No web page loads anything from the extension.

## Decision

- **Nothing is web-accessible.** The manifest declares no `web_accessible_resources`, and the
  `noWebAccessibleResources` plugin in `vite.config.ts` removes the entry crx adds, after crx
  writes the manifest. The build fails if it can't find the manifest to strip.
- **The source tab's title never reaches a content script.** `SessionIndicator` has no tab
  name. The badge reads "TypeTarget 1:05", and the saved `.txt` file is named only by date and
  time. Only the popup shows the source tab's title.
- **Content-script click handlers ignore events with `isTrusted` false** (`isUserEvent` in
  `src/content/user-event.ts`), so a page script can't press the badge's buttons or pick a
  field during selection mode.

## Consequences

- On a page TypeTarget has not been used on, there is nothing to detect: no file to probe, no
  content script, nothing in the DOM. The content script's install flag lives in its isolated
  world, which page scripts can't see.
- **A page TypeTarget is used on can still see it there.** While a field on the page is the
  output (or being picked), the page can see the outline's style element and class, the badge
  and its buttons, the "Type to new file" box, and the text as it is inserted. Using
  TypeTarget on a page requires this. All of it is removed when the user stops typing there,
  except a "Type to new file" box the user keeps. [ADR 0013](0013-option-to-hide-indicators-on-the-page.md)
  adds a setting that draws none of it on the page's own text boxes.
- A future content script that needs its own CSS, images or chunks has to inline them. Making
  them web-accessible would reopen the probe.
- The dev server (`npm run dev`) still lists everything as web-accessible, which crx's HMR
  needs. Only builds are covered.
- The strip depends on crx emitting `manifest.json` as a bundle asset. Recheck after upgrading
  `@crxjs/vite-plugin` that `dist/manifest.json` has no `web_accessible_resources`.

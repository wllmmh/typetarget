# Contributing

## Setup

You need Node.js with npm (the repo uses `package-lock.json`) and Chrome or Chromium 116 or
later.

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose
`dist/`.

Local Whisper needs the vendored whisper.cpp build at `third_party/whisper-wasm/libmain.js`.
It is not committed. Without it the build prints a warning, and the extension works with
hosted models only. To rebuild it, see
[docs/specs/whisper-wasm-provenance.md](docs/specs/whisper-wasm-provenance.md).

## Checks

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint over the repo |
| `npm test` | Vitest (jsdom) |
| `npm run build` | typecheck, then `vite build` into `dist/` |
| `npm run dev` | Vite dev server with crxjs HMR (port 5175) |

`dist/` is committed, so a build shows up as changes there. Rebuild before committing source
changes.

## Testing in Chrome

Unit tests use a fake `chrome` (`src/test/fake-chrome.ts`). The service worker's tests load
the real module against it and drive it through the listeners it registers
(`service-worker.test.ts`). That fake has hidden real behaviour before, so check changes to
capture, messaging or insertion in a real browser too.

- **Reload the destination page, not just the extension**, after changing the content
  script. Old injected instances live on in the page.
- **Rebuild `dist/` before every harness run.** A stale build passes silently.
- Playwright cannot click the toolbar action, so `activeTab` is never granted headlessly.
  Harnesses need a throwaway copy of `dist/` with `host_permissions` added.
- `page.evaluate` does not work on extension pages, because their CSP forbids eval.
- A context never receives its own `chrome.runtime.sendMessage`. Send popup requests from a
  real extension page, not from the service worker.
- To test insertion without tab capture, open `src/offscreen/index.html` as a tab. The
  service worker accepts `transcript-event` from that URL, so finals go through the real
  router and content script.
- Playwright cannot click the native context menu.
  `chrome.contextMenus.onClicked.dispatch(info, tab)` from the service worker runs the real
  listener, but grants no `activeTab`.
- A stand-in local media stream is not a tab capture stream. Tab capture only feeds one
  consumer (see [ARCHITECTURE.md](ARCHITECTURE.md)).
- jsdom has no `isContentEditable`, `innerText` or IndexedDB. Follow the existing
  workarounds in `eligible-elements.ts`, `save-text-file.ts` and `src/test/setup.ts`.

## Pull requests

Open pull requests against `main`. Run typecheck, lint and tests first, and include the
rebuilt `dist/`. Record user-facing changes in [CHANGELOG.md](CHANGELOG.md). A change that
reverses an earlier decision needs a new ADR in [docs/adr/](docs/adr/).

## Releasing

1. Bump `version` in `package.json`. The manifest reads it from there.
2. Move the `[Unreleased]` entries in [CHANGELOG.md](CHANGELOG.md) under the new version.
3. Build, check that `dist/whisper/libmain.js` exists (the build only warns when it is
   missing), and zip the *contents* of `dist/` so `manifest.json` sits at the root:

   ```sh
   npm run build && (cd dist && zip -r ../typetarget-<version>.zip .)
   ```

   `LICENSE` and `THIRD_PARTY_NOTICES.md` are copied into `dist/` by the build.
4. Fill in the Chrome Web Store dashboard from
   [docs/business/store-listing.md](docs/business/store-listing.md), and work through its
   "Before submitting" checklist.

# 0007. API keys in `chrome.storage.local`, restricted to extension pages
- Status: Accepted
- Date: 2026-09-22

## Context

Hosted models need the user's own API key. TypeTarget has no backend, so the key has to live
in the browser. MV3 offers nothing better than extension storage short of hand-rolled
encryption, and encryption whose key also lives in the browser would add complexity without
protecting anything.

## Decision

- Store keys in `chrome.storage.local` under `apiKeys`, keyed by provider. The key never goes
  to `storage.sync`.
- Never send a key back to the popup. `PublicAppState.apiKeyProviders` only lists which
  providers have one, and the dialog shows "•••• saved".
- Restrict `storage.local` to trusted contexts (`setAccessLevel({ accessLevel:
  "TRUSTED_CONTEXTS" })`) on every service-worker start. By default content scripts can read
  it, and TypeTarget's content script runs inside arbitrary pages. This was added on
  2026-10-08 after the [privacy audit](../privacy-audit.md).
- Send a key only to its own provider, and read it per request or connection, so a changed
  key takes effect without a restart.

## Consequences

- Keys are stored unencrypted in the Chrome profile, which is normal for bring-your-own-key
  extensions and is disclosed in [PRIVACY.md](../../PRIVACY.md).
- A key saved while idle has to be handed to a freshly created offscreen document before the
  model loads (`CaptureController.start`).

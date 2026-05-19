# ADR-0007: Simplification pass — drop live selection, persisted drafts, options Test button

Status: Accepted
Date: 2026-05-19

## Context

Three features carried real complexity for low marginal value once
the extension was in daily use:

1. **Live selection streaming.** An always-on content script (declared
   in `manifest.content_scripts` matching `http(s)://*/*`) listened to
   `selectionchange` and posted to the side panel via
   `chrome.runtime.sendMessage`. The side panel ran a separate
   `chrome.runtime.onMessage` handler scoped by `sender.tab.id`.
   ~30 lines of content-script + adapter, plus a `SelectionEvent`
   message type, plus an `onSelectionEvent` port. Largest install-
   prompt surface (broad host match) for a feature that users rarely
   notice — most selections are static by the time the panel is open.

2. **Per-tab draft persistence.** Notes were stored in
   `chrome.storage.session` keyed by `draft:<tabId>` with a 250 ms
   debounced write on every keystroke. The service worker carried a
   `chrome.tabs.onRemoved` cleanup listener. The side panel restored
   on mount, persisted on input, cleared on success. A `DraftStorage`
   port wrapped all of it. Drafts only survive while the browser is
   running anyway (session storage clears on restart) — most usable
   horizon for a one-shot dispatcher is "while the panel is open."

3. **Options "Test connection" button.** Fired `getMe` + `getChat`
   against the user-entered token to verify before saving. ~35 lines
   plus a reveal/hide toggle plus a verify panel in the markup. The
   dispatcher already returns the same `reason` discriminants
   (`unauthorized`, `bad_chat`, …) on the first real Send.

## Decision

- **Selection** is read with one `chrome.scripting.executeScript`
  call at panel mount and on every `chrome.tabs.onActivated` /
  `onUpdated`. No content script declared in the manifest. No
  `content_scripts` permission surface.
- **Drafts** live in a `Map<tabId, string>` inside the side-panel
  controller for the lifetime of the panel. Switching tabs preserves
  each tab's draft; closing the panel discards everything. No
  `chrome.storage.session` involvement; no SW cleanup listener.
- **Options page** has token, chat-id, Save. No Test button, no
  reveal toggle, no verify panel. Status row reports save success
  only; connection problems surface in the side-panel status line
  on first send.

## Consequences

- Lost: live highlight mirroring while the panel is open and the user
  is on the same tab. If the user changes their highlight after the
  panel is mounted, the chip won't refresh until they leave the tab
  and come back.
- Lost: drafts surviving panel close. The panel is intended to be
  open just long enough to compose-and-send.
- Lost: pre-save connection verification. First Send is the verifier.
- Removed: ~30 LOC content script + adapter, ~40 LOC draft port +
  storage glue, ~35 LOC options-test code, two message-type
  definitions, the `http(s)://*/*` host match in the manifest, and
  the service worker's tab-removed cleanup.
- Net source: dropped from ~470 to ~340 LOC; tests dropped a
  proportional amount; one broad permission gone.

## Alternatives considered

- **Keep live selection but drop the content script** by polling
  `getSelection()` from the side panel via `executeScript` on a
  timer. Rejected — polling at the cadence selectionchange fires
  costs more than the script saved.
- **Keep drafts in `localStorage` instead of session storage** to
  survive panel close. Rejected — extending lifetime invites stale
  drafts on tabs the user already closed; the per-tab keying is what
  made the original design defensible, and persistence beyond panel
  lifetime is a different feature.
- **Replace Test button with a "tap to verify" prompt the first time
  config is saved.** Considered — but the first real Send already
  reports the same errors, so the Test path is only useful if you
  want to verify without dispatching anything, which is a niche.

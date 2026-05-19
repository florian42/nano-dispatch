---
name: chrome-extension-review
description: Review Chrome extension code (MV3) against the project's best-practices notes — security, permissions, service worker lifecycle, CSP, storage, messaging, side panel, Web Store policy. Use when reviewing a PR / diff / branch that touches manifest.json, the service worker, content scripts, side panel, options page, or any chrome.* API call; when the user asks to audit extension security, permissions, or MV3 compliance; or before publishing to the Chrome Web Store.
---

# Chrome Extension Review

Read `docs/chrome-extension-best-practices.md` first — it's the authoritative checklist this skill enforces. Cite section numbers in findings (e.g. "violates §1 SW lifecycle").

## Scope

Determine what changed: `git diff main...HEAD --stat` (or the diff the user supplied). Focus the review on touched files; skim the rest only for cross-cutting risks.

## Severity scale

- **blocker** — ships a bug or Web Store rejection risk (remote code, missing CSP, `eval`, `<all_urls>` without justification, secrets in source, listener registered in async callback, XSS via `innerHTML`).
- **major** — wrong API choice that will break under MV3 SW lifecycle, broken on cross-window edge cases, or violates Limited Use / single-purpose policy.
- **minor** — style, naming, missed opportunity (no debounce on save, missing `aria-*`, no `default_locale`).

## Review checklist

Walk through these in order. Skip sections that aren't touched. Quote file:line for every finding.

### Manifest (§4, §17)
- [ ] `manifest_version: 3`; `background.type: "module"` if SW uses ESM
- [ ] Permissions: each one used? `activeTab` over broad hosts where possible?
- [ ] `host_permissions`: narrowest patterns; no `<all_urls>` unless justified
- [ ] CSP: present, no `'unsafe-eval'` / `'unsafe-inline'` / remote hosts
- [ ] `default_locale` if `_locales/` exists
- [ ] `externally_connectable.matches` never `<all_urls>`

### Service worker (§1, §2)
- [ ] All `addListener` calls top-level and synchronous (the #1 bug)
- [ ] No `setTimeout`/`setInterval` for anything beyond the current turn — `chrome.alarms` instead
- [ ] No module-scope mutable state used as source of truth — `chrome.storage.session` or hydrate on event
- [ ] No keep-alive pings or idle ports held to prevent termination
- [ ] `runtime.onMessage` async handlers: `return true` **or** return Promise, never both
- [ ] No `window` / `document` / `localStorage` / `XMLHttpRequest` references
- [ ] No dynamic `import()` of unbundled modules

### Security (§4)
- [ ] No `eval`, `new Function`, `setTimeout("string", …)`
- [ ] No remote `<script>`; all JS bundled in package
- [ ] `innerHTML` / `outerHTML` / `insertAdjacentHTML` on untrusted content → DOMPurify or `textContent`
- [ ] `runtime.onMessage` validates `sender.id === chrome.runtime.id` and message shape
- [ ] Content scripts don't leak state to page via `window` / `dataset` / custom events
- [ ] No API keys / secrets in source (greppable patterns: `sk_`, `Bearer `, hard-coded tokens)
- [ ] Tokens stored in `storage.local` are disclosed; ephemeral secrets prefer `storage.session`

### APIs (§5–§10, §16)
- [ ] `chrome.storage.sync` items ≤ 8 KB, total ≤ 100 KB
- [ ] No `localStorage` in extension pages
- [ ] Active-tab query uses `lastFocusedWindow: true` (not `currentWindow`) where SW/panel may not have focus
- [ ] `chrome.scripting.executeScript` `func` uses `args` (no closure capture)
- [ ] Network blocking via `declarativeNetRequest`, not `webRequest`
- [ ] Cross-origin `fetch` covered by `host_permissions`

### UI (§11–§15)
- [ ] Right surface chosen (popup vs side panel vs options)
- [ ] Side panel `open()` invoked from a user gesture
- [ ] Options persisted on change (or explicit Save) with confirmation
- [ ] Keyboard nav, visible focus rings, contrast ≥ 4.5:1
- [ ] i18n via `__MSG_*__` and `chrome.i18n.getMessage`, not hard-coded strings

### Build / test (§20–§25)
- [ ] SW bundled to single file; manifest path matches dist output
- [ ] `chrome.*` calls behind an adapter or otherwise testable
- [ ] No `format: 'iife'` for `type: module` SW

### Web Store policy (§17–§19)
- [ ] Single-purpose statement still holds for the change
- [ ] Any new permission has a written justification
- [ ] Privacy policy URL still accurate if data flow changed
- [ ] No ad injection, affiliate rewriting, new-tab hijacking

## Output format

Group findings by severity. For each:

```
[blocker] src/background/service-worker.ts:42 — listener registered inside async callback (§1)
  chrome.storage.local.get(['cfg'], () => {
    chrome.runtime.onMessage.addListener(handler); // lost on SW restart
  });
  Fix: hoist addListener to top level; load cfg lazily inside handler.
```

End with a one-line verdict: `LGTM`, `LGTM with minors`, or `Changes requested — N blockers, M majors`.

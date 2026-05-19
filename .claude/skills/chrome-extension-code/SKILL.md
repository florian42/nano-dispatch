---
name: chrome-extension-code
description: Write or modify Chrome extension code (MV3) following the project's best-practices notes — service worker, content scripts, side panel, options page, manifest, chrome.* API calls. Use when editing manifest.json or any file under src/ that touches chrome.* APIs (storage, runtime, tabs, scripting, action, sidePanel, alarms, permissions, scripting, declarativeNetRequest, i18n, offscreen, identity); when adding a new permission, message type, or background event; or when wiring a new UI surface (popup, side panel, options page).
---

# Chrome Extension Code

Read `docs/chrome-extension-best-practices.md` before writing non-trivial extension code. The rules below are the load-bearing ones; the doc has the full detail (referenced by section).

## Hard rules (don't violate without explicit user override)

1. **Service worker listeners are top-level and synchronous** (§1). Never `addListener` inside an async callback, `await`, or `import()`.
2. **No module-scope mutable state in the SW.** Hydrate from `chrome.storage.session` (or `local`) on each event (§1, §5).
3. **No `setTimeout` / `setInterval` for delayed/recurring work** — use `chrome.alarms` (§1).
4. **No `eval`, `new Function`, `setTimeout("string", …)`, or remote code** (§4). All JS ships in the package.
5. **No `innerHTML` / `outerHTML` / `insertAdjacentHTML` on untrusted content** — `textContent` or DOMPurify (§4).
6. **Validate `sender.id === chrome.runtime.id` in `runtime.onMessage`**; validate message shape (§4).
7. **Async `onMessage`**: `return true` *or* return a Promise — never both (§6).
8. **No secrets in source.** User-supplied tokens go in `storage.local` with disclosure; ephemeral secrets in `storage.session` (§4).
9. **Use `activeTab` over broad host_permissions** when a user gesture triggers the action (§4).
10. **No `localStorage` / `XMLHttpRequest` / `window` / `document` in the SW** (§2).

## Decision shortcuts

- **Need to schedule work?** → `chrome.alarms` (min 30s period).
- **Need state to survive the next SW idle?** → `chrome.storage.session` for hot state, `local` for persistent.
- **Need DOM/parser/clipboard from background?** → `chrome.offscreen.createDocument` (§3).
- **Need to read page globals?** → `chrome.scripting.executeScript({ world: 'MAIN', func, args })` — lose `chrome.*` access (§7).
- **Need to inject a one-shot action on user click?** → `activeTab` + `chrome.scripting.executeScript`, no host_permissions.
- **Need active tab?** → `chrome.tabs.query({ active: true, lastFocusedWindow: true })` (not `currentWindow`) (§8).
- **Async response to `sendMessage`?** → `return true` and call `sendResponse` later, or write the handler as `async` (Chrome 148+).
- **Need to block requests?** → `chrome.declarativeNetRequest`. `webRequest` is observation-only (§16).

## Patterns to use

### SW listener registration

```js
// top-level
chrome.action.onClicked.addListener(handleClick);
chrome.runtime.onMessage.addListener(handleMessage);
chrome.alarms.onAlarm.addListener(handleAlarm);

// async work is fine inside handlers
async function handleClick(tab) { /* … */ }
```

### Typed message protocol (TS, §21)

```ts
type Msg =
  | { kind: 'capture'; tabId: number }
  | { kind: 'dispatch'; html: string };

function sendMessage<R>(m: Msg): Promise<R> { return chrome.runtime.sendMessage(m); }

chrome.runtime.onMessage.addListener((m: Msg, sender, send) => {
  if (sender.id !== chrome.runtime.id) return;
  switch (m.kind) {
    case 'capture': handleCapture(m.tabId).then(send); return true;
    case 'dispatch': handleDispatch(m.html).then(send); return true;
  }
});
```

### Hydrate state instead of caching in module scope

```js
async function getDraft() {
  const { draft = null } = await chrome.storage.session.get('draft');
  return draft;
}
```

### Inject with args (no closure capture)

```js
const [{ result }] = await chrome.scripting.executeScript({
  target: { tabId },
  func: (sel) => document.querySelector(sel)?.innerText ?? null,
  args: [selector],
});
```

### Side panel open on click

```js
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
// Or, programmatically (requires user gesture):
chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ tabId: tab.id }));
```

### Sanitize captured page content

```js
import DOMPurify from 'dompurify';
panelEl.innerHTML = DOMPurify.sanitize(rawHtml);
// or, for plain text:
panelEl.textContent = rawText;
```

## Before you finish

- [ ] Did you add a new permission? Justify it in the manifest comment and in the Web Store dashboard later.
- [ ] Did you add a new message kind? Update the discriminated union and both ends.
- [ ] Did you touch the SW? Confirm listeners are top-level and no module-scope state was introduced.
- [ ] Did you touch rendering? Confirm no `innerHTML` on untrusted content.
- [ ] Did you add a `chrome.storage.sync` write? Confirm item ≤ 8 KB.

After non-trivial changes, suggest running the `chrome-extension-review` skill on the diff.

## Reference

Full rationale, edge cases, and source links: `docs/chrome-extension-best-practices.md`.

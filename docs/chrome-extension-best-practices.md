# Chrome Extension MV3 — Best Practices & Guidelines

Consolidated research notes covering Manifest V3 architecture, security, core APIs, UX, Web Store policies, and build/test workflow. Sourced from developer.chrome.com, Chrome Web Store program policies, and Chrome Extensions samples.

---

## 1. Service Worker Lifecycle

The MV3 background context is a **service worker** (SW), not a persistent page. It is event-driven and ephemeral.

**Termination triggers:**
- 30 seconds of inactivity (no events, no API calls)
- Single event handler running longer than 5 minutes
- A `fetch()` taking longer than 30 seconds

**Startup events:** on install → `install` → `chrome.runtime.onInstalled` → `activate`. On profile start → `chrome.runtime.onStartup`.

### Do
- Treat every entry into the SW as a **cold start**. Re-read state, re-init clients.
- Use `chrome.alarms` for delayed or recurring work (minimum period 30s since Chrome 120).
- Keep handlers fast; offload long work to a content script, offscreen document, or alarm-driven chunks.
- Register event listeners **synchronously at the top level** of the SW.

### Don't
- Don't rely on `setTimeout`/`setInterval` past the current event turn — timers die with the worker.
- Don't ping yourself or hold idle `runtime.Port` connections to "stay alive" — sanctioned antipattern.
- Don't store source-of-truth state in module globals — they vanish on termination.

### The #1 SW bug: late listener registration

```js
// WRONG — listener registered inside async callback; lost on next wake
chrome.storage.local.get(['x'], () => {
  chrome.action.onClicked.addListener(handleClick);
});

// RIGHT — top-level, synchronous
chrome.action.onClicked.addListener(handleClick);
chrome.storage.local.get(['x'], () => { /* ... */ });
```

Handler **bodies** can be async; only `addListener` calls must be synchronous. For `chrome.runtime.onMessage` with async work, `return true;` to keep the channel open, or (Chrome 148+) return a Promise — never both.

### chrome.alarms pattern (the timer replacement)

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('poll', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll') await poll();
});
```

Alarms persist across SW termination and wake the worker.

---

## 2. Module-Type Service Workers

```json
"background": { "service_worker": "sw.js", "type": "module" }
```

- Enables static `import` from bundled JS, relative to extension root.
- **Dynamic `import()` is not supported.** Neither are import assertions.
- Without `"type": "module"`, use `importScripts()` (classic worker).
- No `window`, no `document`, no `localStorage`, no `XMLHttpRequest`. Use `fetch`, `chrome.storage`, `self`.
- All code must ship in the package — **no remote code**.

---

## 3. Background SW vs Offscreen Documents

Use an offscreen document when you need a real DOM/`window`:

```js
chrome.offscreen.createDocument({
  url: 'offscreen.html',
  reasons: ['DOM_PARSER'],
  justification: 'Parse captured HTML safely',
});
```

Valid reasons: `DOM_PARSER`, `DOM_SCRAPING`, `IFRAME_SCRIPTING`, `AUDIO_PLAYBACK`, `USER_MEDIA`, `DISPLAY_MEDIA`, `WEB_RTC`, `CLIPBOARD`, `LOCAL_STORAGE`, `BLOBS`, `WORKERS`, `BATTERY_STATUS`, `MATCH_MEDIA`, `GEOLOCATION`, `TESTING`.

Limitations: one offscreen document per extension, cannot be focused, only `chrome.runtime` API available. Talk to SW via messages. `AUDIO_PLAYBACK` auto-closes after 30 s of silence; others stay until `closeDocument()`.

---

## 4. Security & Permissions

### Principle of least privilege

- `activeTab` over broad host_permissions whenever possible — temporary access on user gesture, **no install warning**, expires on navigation/close.
- Optional permissions: request at runtime inside a user-gesture handler.

```js
const granted = await chrome.permissions.request({
  permissions: ['bookmarks'],
  origins: ['https://example.com/*'],
});
```

### Host permissions install warnings

- `<all_urls>`, `*://*/*` → harshest warning ("Read and change all your data on all websites"). Heightened review.
- Specific origins → per-domain warning, narrower.
- Users can downgrade your access via the Site Access dropdown. Code defensively.

### Content Security Policy (default for `extension_pages`)

```
script-src 'self'; object-src 'self';
```

- No `'unsafe-inline'`, no `'unsafe-eval'`, no remote `script-src` hosts.
- WASM via `'wasm-unsafe-eval'` if declared.
- Banned: inline `<script>`, `onclick="…"`, `eval`, `new Function`, `setTimeout("string", …)`, `<script src="https://cdn…">`.

For untrusted HTML rendering or eval-requiring libs, use a **sandbox page** with `chrome.runtime` isolation and `postMessage`.

### Remote code ban

MV3 forbids executing JS/WASM not bundled in the package. Fetching **data** is fine (JSON, config) — never branch on remotely-supplied code.

### Message-passing security

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.tab || !isAllowedOrigin(sender.tab.url)) return;
  // strictly validate msg shape
});
```

- `externally_connectable.matches` — never `<all_urls>`.
- Treat every message from a content script as untrusted input.

### Content scripts & isolated worlds

- Default `world: "ISOLATED"` — same DOM as page, separate JS heap.
- `world: "MAIN"` — needed to read page globals; **loses all `chrome.*` APIs**, exposes state to the page.
- Don't leak extension state via `window`, `dataset`, or custom events readable by the page.
- DOM-node properties may be hijacked by the page; use cached intrinsics for hardened reads.

### Storage of secrets

- `chrome.storage.local`: unencrypted on disk. OK for user-supplied tokens with disclosure.
- `chrome.storage.session`: in-memory, cleared on browser restart. Ideal for ephemeral secrets.
- `chrome.storage.sync`: cross-device sync via Google account; treat as more sensitive.
- **Never** ship API keys/secrets in source. Use a backend proxy or OAuth via `chrome.identity.launchWebAuthFlow` / `getAuthToken`.

### XSS / injection

`innerHTML` on captured page content → XSS in your extension's origin (which holds `chrome.*` privileges).

Safe rendering:
- `el.textContent = untrusted` for plain text
- `DOMPurify.sanitize(html)` for rich content
- Sandbox-page iframe + `postMessage` for arbitrary untrusted HTML

Enforce **Trusted Types** via CSP for whole-class XSS protection:
```
require-trusted-types-for 'script'; trusted-types default dompurify;
```

Other sinks to guard: `location = userInput`, `setAttribute('href', userInput)` (check scheme), `chrome.tabs.create({url})`, building `chrome.scripting.executeScript({func})` from strings.

---

## 5. chrome.storage

| Area | Quota | Per item | Persistence | Use for |
|---|---|---|---|---|
| `local` | 10 MB (unlimited with permission) | — | Across restarts | Drafts, caches, large blobs |
| `sync` | ~100 KB total | 8 KB | Cross-device | Small user prefs |
| `session` | 10 MB | — | In-memory, cleared on SW restart | SW scratch state, transient auth |
| `managed` | — | — | Read-only | Enterprise policy |

### Do
- Use `session` to survive SW idle (don't keep state in module globals).
- Batch writes: `storage.set({a, b, c})` is one atomic write + one `onChanged` event.
- React via `chrome.storage.onChanged.addListener((changes, areaName) => …)`.

### Don't
- Don't use `localStorage`/`sessionStorage` — SW can't access Web Storage; it's wiped with browsing data.
- Don't stuff large objects in `sync` — `QUOTA_BYTES_PER_ITEM` will silently truncate. Sync writes are also rate-limited (120/min, 1,800/hr).
- Don't assume sequential `set` calls are atomic together — only single calls.

---

## 6. Messaging

| API | Direction | Lifetime |
|---|---|---|
| `chrome.runtime.sendMessage` | any context ↔ SW / extension pages | one-shot |
| `chrome.tabs.sendMessage(tabId, …)` | extension → content script in tab | one-shot |
| `chrome.runtime.connect` / `tabs.connect` | bidirectional Port | long-lived |
| `runtime.onMessageExternal` + `externally_connectable` | other extensions / allowlisted web pages | one-shot |

```js
// Classic async — return literal true
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsync().then(sendResponse);
  return true;
});

// Chrome 148+ — return a Promise (don't combine with return true)
chrome.runtime.onMessage.addListener(async (msg) => await doAsync());
```

- Always wrap `await chrome.tabs.sendMessage` in `try/catch` — throws `Receiving end does not exist` if the content script isn't injected.
- Messages must be JSON-serializable (≤ 64 MiB).
- Use ports for streaming, progress, or many round-trips.

---

## 7. chrome.scripting

```js
await chrome.scripting.executeScript({
  target: { tabId, allFrames: false },
  world: 'ISOLATED',
  func: (sel) => document.querySelector(sel)?.innerText,
  args: ['h1'],
});
```

- `args` is required for parameterization — `func` has **no closure capture**.
- `frameIds` and `allFrames` are mutually exclusive.
- Returns `InjectionResult[]`, main frame first; if `func` returns a Promise it's awaited.

Dynamic registration replaces manifest-static content scripts when you need runtime control:

```js
await chrome.scripting.registerContentScripts([{
  id: 'site-helper',
  matches: ['https://*.example.com/*'],
  js: ['cs.js'],
  runAt: 'document_idle',
  world: 'ISOLATED',
}]);
```

Requires `"scripting"` + host permissions (or `activeTab`).

---

## 8. chrome.tabs — active tab

```js
// Survives the "no focused Chrome window" case (devtools popped out, side panel detached)
const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
```

- `currentWindow: true` returns nothing when no Chrome window is focused. `lastFocusedWindow: true` falls back.
- DevTools/app windows may have `id === chrome.tabs.TAB_ID_NONE`.
- `url`, `title`, `favIconUrl`, `pendingUrl` need `"tabs"` permission **or** matching host_permissions **or** `activeTab`.
- Lifecycle: `onUpdated` — filter `changeInfo.status === 'complete'`.

---

## 9. chrome.action

- Badge: `setBadgeText({text, tabId?})`, ~4 chars; auto-contrast text color if unset.
- `onClicked` and `default_popup` are **mutually exclusive** — popup wins. Use `setPopup({tabId, popup: ''})` for conditional click events.
- All setters accept optional `tabId` for per-tab overrides.

---

## 10. chrome.sidePanel

```js
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.sidePanel.setOptions({ tabId, path: 'panel.html', enabled: true });
```

- Per-tab options override global.
- `sidePanel.open({ tabId | windowId })` requires a **user gesture** (Chrome 116+).
- Panel persists across navigations in a tab; switching to a disabled tab hides it; returning re-shows.
- Treat the panel document as long-lived — clean up listeners on `pagehide`.

---

## 11. UI surface choice

| Surface | Lifecycle | Best for |
|---|---|---|
| Popup | Closes on blur — loses state | Quick ≤ 10s actions, status |
| Side panel | Persists across tabs; per-tab/window scope | Companion tools used alongside the page |
| Options page | Dedicated tab or embedded | Settings, accounts |
| Content script | Page context | DOM-level features in-page |
| Override page | Replaces New Tab/History/Bookmarks | Heavy primary surfaces |

- Popup max ~800×600, no resize, dies on blur — treat as stateless.
- Side panel = mini SPA. User controls width.
- Options: prefer `open_in_tab: true` for anything non-trivial. Embedded options can't use Tabs API and have sizing quirks.

---

## 12. Options page conventions

- Persist via `chrome.storage.sync` for small prefs; `local` for larger/local-only.
- Save-on-change (debounced) for toggles/dropdowns; explicit Save button for multi-field forms.
- Show "Saved" confirmation; restore on load.
- Link from popup/side panel via `chrome.runtime.openOptionsPage()`.

---

## 13. Onboarding & first run

```js
chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
  if (reason === 'update' && needsMigration(previousVersion)) migrate();
});
```

- Open welcome tab on first install — state single purpose, show pin-the-icon, request optional perms just-in-time.
- Request optional permissions inside a click handler with inline rationale.
- `chrome.runtime.setUninstallURL()` → short feedback form.

---

## 14. Accessibility

- Full keyboard nav; visible focus rings; `Esc` to close transient panels.
- Semantic HTML first; ARIA only where needed.
- Focus management: on panel open, focus heading or primary action; restore on close.
- Contrast ≥ 4.5:1; respect `prefers-color-scheme`, `prefers-reduced-motion`.
- Don't rely on color alone for state.

---

## 15. Internationalization

- `_locales/<lang>/messages.json`; manifest `"default_locale": "en"`.
- `__MSG_name__` in manifest/CSS; `chrome.i18n.getMessage('name', [substitutions])` in JS (≤ 9 substitutions).
- Translating `name` and `description` in `messages.json` auto-translates the store listing per locale.

---

## 16. Network requests

- `fetch()` works in the SW; cross-origin requires matching `host_permissions` (or `activeTab` at user invocation).
- Blocking/redirecting: **`chrome.declarativeNetRequest` only**. `webRequest` is observation-only in MV3 (except force-installed enterprise extensions with `webRequestBlocking`).
- DNR limits: 30,000 dynamic rules, 5,000 session rules, ≥ 30,000 across enabled static rulesets.
- Actions: `block`, `redirect`, `upgradeScheme`, `allow`, `allowAllRequests`, `modifyHeaders`.

---

## 17. Chrome Web Store policies

- **Single purpose** (hard rule): one narrow function. Permission set must match. Re-read your single-purpose statement each time you add a feature.
- **Permissions justification**: each permission + each host pattern needs a written justification in the dashboard. Broad hosts (`<all_urls>`) demand strong reasons and trigger deeper review.
- **Privacy policy URL required** whenever the extension handles any user data — including settings synced via `storage.sync` containing personal content.
- **Limited Use**: data may only be used to deliver/improve the stated single purpose. No selling to data brokers, no personalized ads, no credit decisions, no transferring (except service providers, legal, or explicit user consent).
- **Prohibited**: remote code execution, ad injection, deceptive installs, affiliate stuffing, obfuscated code, repurposing the new-tab page without disclosure.
- **2-step verification** required on the developer account.

---

## 18. Listing best practices

- Title ≤ 45 chars, no keyword stuffing.
- Short description (132 chars) = elevator pitch in search results.
- Detailed description: what it does, who it's for, what permissions exist and why.
- Assets: 128×128 icon, 440×280 small promo tile, 1280×800 (or 640×400) screenshots — 1 to 5. Show real UI.
- Version: max 4 dot-separated integers, each ≤ 65535; must strictly increase per upload.
- Partial rollout supported (5/10/25/50/100%) — use for risky updates.
- Visibility: Public / Unlisted / Private. All reviewed.

---

## 19. Review process & common rejections

- Typical: most within ~24h; ~90% within 3 days. Broad-host or new-developer extensions can take 2–3 weeks. No formal expedited lane.
- Top rejection reasons:
  - Overly broad host permissions without strong justification
  - Missing/inadequate permission justifications
  - No privacy policy when data is collected
  - Single-purpose violation / feature creep
  - Remote or obfuscated code
  - Ad injection or affiliate-link rewriting without disclosure
  - Deceptive metadata, fake reviews, keyword stuffing
  - Manipulating Chrome settings (search, new tab, homepage) without clear UI

---

## 20. Build tooling

- SW must be a single JS file. Static ESM imports work with `"type": "module"`; dynamic `import()` does not.
- esbuild — fastest, simplest. Multiple `entryPoints` map to SW/side panel/options/content scripts.
- Vite — `@crxjs/vite-plugin` handles manifest, HMR for non-SW surfaces.
- Webpack — heaviest; `webpack-extension-reloader` for auto-reload.
- Inline source maps for SW; DevTools loads from `chrome-extension://`.
- Don't ship CSP-violating eval. Don't `format: 'iife'` for a `type: module` SW.

---

## 21. TypeScript

- `@types/chrome`, `"strict": true`.
- Type messages with **discriminated unions**:
  ```ts
  type Msg =
    | { kind: 'capture'; tabId: number }
    | { kind: 'dispatch'; html: string };
  ```
- Wrap `sendMessage` in a typed helper so call sites stay narrow.

---

## 22. Dev loop

- `chrome.runtime.reload()` reloads the extension; trigger from a dev-only message after rebuild.
- SW changes sometimes need a manual toggle at `chrome://extensions`.
- Logs:
  - SW: `chrome://extensions` → "service worker" link
  - Side panel: right-click inside → Inspect
  - Content script: page DevTools, select extension context in dropdown
  - Popup: right-click extension icon → Inspect popup
- SW network requests appear only in SW DevTools, not the page's. Pin DevTools open to keep SW alive during debugging.

---

## 23. Testing

- **Unit (mocked chrome.*)**: `sinon-chrome`, `jest-chrome`, or Vitest with a minimal `BrowserAdapter` interface (preferred — mock the adapter, not the global).
- **Integration**: Playwright with `chromium.launchPersistentContext`, `--load-extension`, `--disable-extensions-except`. Use for SW message flows, side panel UI, content script injection.
- **Not testable without a real browser**: SW install/activate lifecycle, `onInstalled`, side panel rendering, permissions prompts, DNR matching.

### Testable architecture

- Wrap `chrome.*` behind a thin `BrowserAdapter` injected into controllers.
- Keep pure logic (message parsing, reducers, HTML transforms) free of `chrome.*` → trivially unit-testable.
- Controller/view split for side panel and options.

---

## 24. CI/CD

- Lint manifest: `web-ext lint --source-dir=dist` (Mozilla's tool also flags MV3 issues).
- Reproducible zips: strip mtimes, deterministic ordering.
- Publish via `chrome-webstore-upload` — secrets (`CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`, `EXTENSION_ID`) in CI vault.
- Run typecheck + unit + Playwright extension tests before packaging.

---

## 25. Common pitfalls

- Forgetting to bundle → SW throws `Cannot use import statement outside a module`.
- Missing `"type": "module"` on SW with ESM imports → silent registration failure.
- Path mismatch between manifest and dist output. Copy manifest into `dist/` as part of build.
- Content scripts on `chrome://`, `chrome-extension://`, or Web Store pages → injection silently fails. Guard with `host_permissions` and check `tab.url`.
- `sendResponse` async without `return true` → response dropped.
- Assuming SW global state persists — terminates after ~30s idle.
- Storing large objects in `storage.sync` → silent per-item truncation.
- Listener registered inside async callback → lost across SW restarts.

---

## Practical do/don't shortlist for this extension (side-panel + Telegram)

- Do: side panel + small options page; only add a popup if you also want a quick-glance summary.
- Do: ship a welcome tab on `onInstalled`; request optional host permissions on first use.
- Do: declare `default_locale` from day one.
- Do: write a one-sentence single-purpose statement and pin it next to the manifest.
- Do: `chrome.storage.session` for the in-flight dispatch payload; `chrome.storage.local` for the bot token, with explicit disclosure that it's stored unencrypted.
- Do: sanitize captured `body.innerHTML` with DOMPurify before any rendering inside the panel — captured HTML is untrusted page content.
- Do: validate `sender.id === chrome.runtime.id` on every `runtime.onMessage`.
- Don't: ship `<all_urls>` — use `activeTab` and narrow host_permissions to `https://api.telegram.org/*` (already done).
- Don't: `eval`, `new Function`, or fetch-then-execute any code.
- Don't: rely on module-scope state in the service worker.
- Don't: bundle the bot token in source. Users supply their own.

---

## Sources

- developer.chrome.com/docs/extensions (Service workers, lifecycle, events, migration)
- developer.chrome.com/docs/extensions/reference/api/{storage,scripting,tabs,action,sidePanel,permissions,i18n,declarativeNetRequest,offscreen,alarms,runtime}
- developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- developer.chrome.com/docs/webstore/program-policies (Use of Permissions, Remote Code, Limited Use, User Data FAQ, Quality Guidelines)
- developer.chrome.com/docs/webstore/{review-process,cws-dashboard-distribution,best-practices}
- github.com/GoogleChrome/chrome-extensions-samples
- github.com/crxjs/chrome-extension-tools
- web.dev/articles/trusted-types

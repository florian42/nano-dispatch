# ADR-0012: Browser/SW polyfill architecture for GramJS

Status: Accepted
Date: 2026-05-20

## Context

ADR-0011 added esbuild and aliased every Node built-in GramJS imports to
an empty shim, on the assumption that GramJS's conditional Node imports
never execute on browser code paths. Initial unit tests + CLI probe (which
runs in Node where Node built-ins resolve normally) passed.

Loading the extension in Chrome surfaced four distinct failures, each
proving the empty-shim assumption wrong:

1. **SW init crash — `util.inspect.custom`.** GramJS's TL class builder
   defines methods keyed by `[util.inspect.custom]` *at class-definition
   time*. With `util` aliased to `{}`, `util.inspect` is undefined and the
   computed key throws before `chrome.action.onClicked.addListener` is
   ever reached, so the toolbar click silently does nothing.

2. **Click "Send code" — `os.type is not a function`.** `TelegramClient`'s
   constructor reads `os.type()` and `os.release()` to populate the
   `deviceModel` / `systemVersion` fields of `InitConnection` (the values
   Telegram shows in Active Sessions). Empty `os` → undefined methods →
   crash on first client construction.

3. **Send a real message — `crypto.randomBytes is not a function`.**
   GramJS's `telegram/CryptoFile.js` does `import * as crypto from "crypto"`
   and re-exports it as default. Three surfaces are consumed at runtime:
   `randomBytes`, `createHash`, `pbkdf2Sync`. Empty `crypto` → undefined →
   crash on the first MTProto operation that needs randomness or hashing.

4. **Browser detection — `typeof window !== "undefined"`.** GramJS's
   `isBrowser = !isDeno && typeof window !== "undefined"`. False in an MV3
   service worker (the SW global is `self`, not `window`). With
   `isBrowser=false`, GramJS picks Node code paths at runtime — raw TCP
   transport, Node-only crypto — none of which exist or are CSP-allowed.

   Separately, GramJS's `useWSS` default is
   `isBrowser ? window.location.protocol === "https:" : false`. In an
   extension context `location.protocol` is `chrome-extension:` →
   `useWSS=false` → plain `ws://` → blocked by `host_permissions` /
   `content_security_policy.connect-src`, which only allow
   `wss://*.web.telegram.org`.

## Decision

Three layered tiers plus an explicit client option:

### Tier 1 — Empty alias (Node-built-ins GramJS never executes on browser paths)

`build-shims/empty.js` (default-exports `{}`). Aliased modules:
`fs`, `graceful-fs`, `fs/promises`, `net`, `tls`, `dns`, `stream`,
`assert`, `constants`, `zlib`, `path`, `socks`, `http`, `https`,
`events`, `node-localstorage`, `url`, `querystring`.

Build fails loudly with `Could not resolve "<x>"` if a new GramJS release
reaches for a Node module not on this list. The shim list is closed —
it grows by one entry per discovery.

### Tier 2 — Real polyfill shim (Node-built-ins GramJS *does* call at runtime)

Each is a small purpose-built file matching the surface GramJS consumes:

- **`build-shims/util.js`** — exports `inspect.custom` as
  `Symbol.for('nodejs.util.inspect.custom')`. The method keyed by it is
  never invoked; the symbol just needs to exist so the class definition
  doesn't throw.

- **`build-shims/os.js`** — `type()` returns `'Browser'`, `release()`
  returns the user-agent string, `arch()` returns `'web'`, `platform()`
  returns `'browser'`. These surface as the device label in Telegram's
  Active Sessions UI.

- **`build-shims/crypto.js`** — implements `randomBytes` via
  `crypto.getRandomValues`, `createHash` via `crypto.subtle.digest`,
  `pbkdf2Sync` via `crypto.subtle.deriveBits`. Mirrors the API shape of
  GramJS's own internal browser crypto (`telegram/crypto/crypto.js`):
  `digest()` and `pbkdf2Sync()` return Promises despite the sync-sounding
  names — GramJS's call sites already await them.

- **`build-shims/buffer-inject.js`** — re-exports `Buffer` from the
  `buffer` npm polyfill. Wired via esbuild's `inject` option so every
  module referencing `Buffer` as a global gets the polyfill stamped in.
  ~50 KB overhead.

### Tier 3 — Banner (environment-shape gaps the SW can't fix via module aliases)

The service-worker bundle gets a one-line banner prepended:

```js
if (typeof globalThis.window === "undefined" && typeof globalThis.self !== "undefined") {
  globalThis.window = globalThis.self;
}
```

After this, `typeof window !== "undefined"` is true → GramJS's
`isBrowser` is true → all the browser code paths activate.
`window.addEventListener("offline", ...)` becomes
`self.addEventListener(...)` which the SW supports natively.
`window.crypto.subtle` and `window.crypto.getRandomValues` resolve to
the same APIs that exist on `self`.

The options-page bundle gets no banner — it runs in a real document
where `window` already exists.

### Explicit client option — `useWSS: true`

`new TelegramClient(session, apiId, apiHash, { useWSS: true, ... })`
in both `src/dispatcher/gramjs-sender.ts` and `src/options/options.ts`.
Belt-and-suspenders with tier 3: even with `window` aliased to `self`,
`window.location.protocol` is still `chrome-extension:` (the SW or
extension page URL), which would otherwise default `useWSS` to `false`.

### Regression catcher — `scripts/load-sw.mjs`

```bash
npm run verify:sw-init
```

Does `import('./dist/background/service-worker.js')` with stubbed
`chrome.*` and SW-shaped globals (`self = globalThis`, `location` with
`chrome-extension:` protocol, no `window`). Catches top-level bundle
init throws in ~50 ms without needing Chrome. Doesn't exercise handler
logic but proves the listeners register.

This is the loop that found all four issues above: each fix → rerun
load-sw.mjs → next error → next fix. Worth keeping in the harness as a
fast pre-flight before any `dist/` reload in Chrome.

## Consequences

- **Closed shim list.** Each new GramJS surface failure produces a clear
  error message at init or first call. Expected discovery cadence: one
  more per major GramJS upgrade until the surface stabilises.
- **Bundle size unchanged from ADR-0011** — replacing empty shims with
  real ones adds ~5 KB total. The `buffer` polyfill is the dominant
  contribution (~50 KB).
- **`window = self` is a literal alias, not a proxy.** Any GramJS code
  path reaching for a window-only API (`window.localStorage`,
  `window.alert`, `window.document`) would fail with "is not a function"
  or similar. None observed yet.
- **`useWSS: true` is silent and unconditional.** No way for the user to
  opt back into plain WS, which would be CSP-blocked anyway.
- **Cold-start latency.** First send takes ~1–2 s — DH handshake,
  state sync, sendFile, disconnect — because each dispatch builds a
  fresh `TelegramClient`. Subsequent sends in the same SW lifecycle
  reuse some cached state; the SW itself dying after 30 s of idle
  evicts even that. Stage 2's offscreen-document persistent client
  would amortise the cost. Documented in ADR-0008.

## Alternatives considered

- **`esbuild-plugins-node-modules-polyfill`** or `node-stdlib-browser`.
  Adds ~500 KB and another dep for what is effectively three custom
  polyfills. Rejected — small targeted shims are more honest about
  what's actually used and easier to debug when something breaks.
- **Inline polyfill into `service-worker.ts` source** instead of esbuild
  banner. ESM import hoisting runs all imports — including GramJS's
  module init that touches `window` — before any top-level statement in
  the entry file. The banner is the only place that runs code strictly
  first.
- **Proxy-based `window` polyfill** (an earlier draft of this work)
  that overrode `window.location.protocol` to `'https:'` to make
  GramJS's `useWSS` default resolve to true. Rejected — the explicit
  `useWSS: true` client option is more direct, less magic, and survives
  any future GramJS internal change to how it picks the transport.
- **Provide a browser variant of GramJS** (fork the package). Rejected
  — maintenance cost dwarfs the polyfill cost, and the polyfill list
  is small.

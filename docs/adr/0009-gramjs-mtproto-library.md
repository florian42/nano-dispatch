# ADR-0009: GramJS as the MTProto library

Status: Accepted
Date: 2026-05-19

## Context

ADR-0008 commits to MTProto for the dispatch path. MTProto is a
proprietary Telegram protocol — implementing it from scratch is a
multi-month project and a security risk. We need a third-party library.
The library has to run in an MV3 service worker (no Node-only APIs at
runtime; bundleable for the browser).

## Decision

Use [GramJS](https://gram.js.org) (`telegram` on npm).

## Consequences

- **Browser-capable.** GramJS publishes a build that runs in browsers
  and service workers (WebSocket transport, no required Node
  built-ins on the hot path). The auth flow works the same way as in
  Node.
- **API surface is rich.** Stage 1 uses `client.sendFile` and the
  `auth.SignIn` / `auth.CheckPassword` TL methods only. Stages 2+
  (read replies, dialog list) are unblocked on the same client.
- **Bundle size.** ~1.2 MB unminified per surface that imports it.
  Acceptable for a single-user extension; would be re-examined for
  Web Store publishing.
- **Node built-in shimming.** GramJS conditionally imports `fs`,
  `net`, `tls`, `events`, etc. behind environment checks. The build
  aliases all of these to an empty shim — they never execute in the
  browser. The `Buffer` global is provided by injecting the `buffer`
  npm polyfill. See ADR-0011.
- **Maintenance.** GramJS is actively maintained at the time of
  writing (last release < 6 months). If it stops, the `Sender` port
  in ADR-0010 isolates the dependency to one adapter file
  (`src/dispatcher/gramjs-sender.ts`) and the dispatcher core remains
  library-agnostic.

## Alternatives considered

- **Raw MTProto.** Implementing the protocol against the public spec.
  Estimated weeks of work plus a security review. Rejected.
- **TDLib via WebAssembly.** Telegram's official C++ client compiled
  to WASM. Largest bundle (~10 MB+), heavyweight async bootstrap
  (file-system mounting, worker threads), API documented in TDLib
  JSON but TypeScript types are community-maintained and patchy.
  Overkill for a send-only dispatch path.
- **Telethon via Pyodide.** Python's MTProto library running in a
  WebAssembly Python interpreter. Bundle and startup costs dwarf
  GramJS. Rejected.
- **mtproto-core / @mtproto/core.** Smaller browser-first MTProto
  library, but less actively maintained and lighter on documented
  TypeScript types. Held in reserve; revisit if GramJS goes
  unmaintained.

# ADR-0010: Dispatcher takes an injectable `Sender` port (supersedes ADR-0001 for the transport seam)

Status: Accepted
Date: 2026-05-19

## Context

ADR-0001 designed the dispatcher's testability seam as an injected
`fetch`. That worked because the Bot API was an HTTP request and the
seam was the network call itself. With MTProto (ADR-0008), the
transport is a stateful GramJS client over WebSocket — `fetch` is no
longer a meaningful boundary. We need a new seam.

Two design pressures:

1. **Keep the dispatcher GramJS-ignorant.** The dispatcher is the deep
   module — composes the message, classifies errors, returns a
   discriminated result. It should not depend on a heavyweight
   MTProto client.
2. **Tests should stay plain.** ADR-0001's no-`vi.mock`, no-global
   monkey-patching constraint stands. Stubbing a function-interface
   inline from the test is the gold standard.

## Decision

The dispatcher takes a third positional argument of type `Sender`:

```ts
export interface Sender {
  sendDocument(input: {
    peer: string;
    fileBytes: Uint8Array;
    fileName: string;
    mimeType: string;
    caption: string;
  }): Promise<{ messageId: number }>;
}

export async function dispatch(
  payload: DispatchPayload,
  config: DispatchConfig,
  sender: Sender,
): Promise<DispatchResult>
```

The production `Sender` is `createGramSender(...)` in
`src/dispatcher/gramjs-sender.ts`, which wraps a `TelegramClient` and
translates GramJS RPC errors into bare TL error names
(`AUTH_KEY_UNREGISTERED`, `PEER_ID_INVALID`, `FLOOD_WAIT_30`) that the
dispatcher's `classify()` pattern-matches. Transport-level failures
(connect errors, socket disconnects) are re-thrown with a
`NETWORK_ERROR:` prefix.

Tests pass a hand-rolled `Sender` that records calls and returns canned
responses or thrown errors — identical pattern to ADR-0001's
`stubFetch`, just at a different layer.

## Consequences

- The dispatcher's surface is narrower than the GramJS surface. Future
  changes to the dispatcher don't reach into the MTProto library, and
  vice-versa.
- ADR-0001's seam is **superseded for transport concerns**. The fetch
  injection no longer exists. ADR-0001 stays in the record as
  historical context.
- The error-classification contract is now a documented part of the
  `Sender` port: the adapter is responsible for surfacing GramJS
  `RPCError.errorMessage` strings to the dispatcher. If a future
  adapter (different library, different transport) is written, it
  must honour the same convention or extend the
  `FailureReason`/classification table.

## Alternatives considered

- **Inject the GramJS `TelegramClient` directly.** Forces the
  dispatcher to know GramJS types and import its API just to satisfy
  type checking. Couples the deep module to a heavyweight dep.
- **Module-level `vi.mock('telegram', ...)`.** Rejected for the same
  reasons ADR-0001 rejected `vi.stubGlobal('fetch', ...)`: invisible
  at the call site, brittle.
- **A ports object `{ sender }`.** Single-dep wrapping is ceremony
  the codebase doesn't need yet.

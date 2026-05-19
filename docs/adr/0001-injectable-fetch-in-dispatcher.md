# ADR-0001: Dispatcher accepts an injected `fetch`

Status: Accepted
Date: 2026-05-19

## Context

The PRD specifies the dispatcher's public contract as `dispatch(payload, config)`
and asks for it to be "unit-tested under Node/Vitest" with `fetch` stubbed
(PRD §Testing Decisions). It does not say *how* the stub is wired.

We dislike module-level mocks (`vi.mock`) and global monkey-patching
(`vi.stubGlobal('fetch', …)`) — both couple tests to the module loader and
hide the dependency from the type system.

## Decision

The dispatcher takes a third, optional parameter:

```ts
export async function dispatch(
  payload: DispatchPayload,
  config: DispatchConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchResult>
```

Production callers pass two arguments and get the platform `fetch` by
default; tests pass a stub that records calls and returns canned
`Response` objects.

## Consequences

- Tests are plain — a stub function is constructed inline, no globals
  touched, no vitest module mocking.
- The signature diverges from `docs/telegram-dispatch.md` §2 by one
  optional positional argument. The doc's contract is still satisfied
  for the documented use; the third parameter is a testability seam.
- Anyone reading the dispatcher sees the dependency explicitly in the
  type, instead of guessing whether it reads `globalThis.fetch`.

## Alternatives considered

- **`vi.stubGlobal('fetch', …)`**: works, but invisible at the call
  site and brittle when tests run in parallel.
- **Pass a port object `{ fetch }`**: more verbose for a single
  dependency. Revisit if the dispatcher ever grows a second injectable.
- **Wrap `fetch` behind a class**: rejected — the dispatcher is one
  function; introducing a class only to enable substitution would be
  ceremony.

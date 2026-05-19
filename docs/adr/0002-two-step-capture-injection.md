# ADR-0002: Two-step capture injection (stash-and-read on isolated globalThis)

Status: **Superseded by [ADR-0006](./0006-raw-html-capture.md)** (2026-05-19)
Date: 2026-05-19

## Context

The PRD's Page Capture module description says:

> Fresh `scripting.executeScript` injection per Send — the capture bundle
> (Readability + Turndown + glue) is loaded into the tab only on user
> gesture, computes, returns its result as the last-evaluated value of
> `executeScript`, and is gone.
> (PRD §Modules → Page capture)

"Last-evaluated value" works for a *non-bundled* classic script: Chrome
returns the value of the script's final expression in
`results[0].result`. It does **not** work cleanly with an esbuild IIFE
bundle: the IIFE wraps the module body in `(() => { … })()`, and esbuild
does not inject a `return` statement for the entry's last expression.
The bundle therefore evaluates to `undefined`.

Options:

1. **Compute then assign to a known global, read it in a follow-up call.**
2. Pass a `func` directly to `executeScript` with the capture logic
   inlined — impossible because Readability and Turndown can't be
   referenced from a string-serialised function body.
3. Have the capture script `chrome.runtime.sendMessage` its result back
   to the service worker — changes the SW into a state-machine waiting
   for an inbound message, complicates the request/response shape.

## Decision

Use option (1) — a two-step `executeScript`:

```ts
// 1. Inject the bundle. The bundle's last statement assigns
//    extract(document, location, selection) to
//    globalThis.__nanoDispatchResult (isolated world).
await chrome.scripting.executeScript({ target: { tabId }, files: ['capture.js'] });

// 2. Read the result and delete it from the global, all in a func that
//    can be serialised because it depends on no imports.
const [first] = await chrome.scripting.executeScript({
  target: { tabId },
  func: () => {
    const g = globalThis as { __nanoDispatchResult?: unknown };
    const r = g.__nanoDispatchResult;
    delete g.__nanoDispatchResult;
    return r;
  },
});
```

The result is then validated by `isCaptureResult` before being passed to
the dispatcher.

## Consequences

- Two RPC round-trips per Send instead of one — negligible latency for
  a user-gesture flow.
- A transient global lives on the isolated-world `globalThis` between
  the two calls. The second call deletes it. If the second call fails
  (rare), a stale `__nanoDispatchResult` may persist on that tab's
  isolated world; the next Send overwrites it.
- The capture bundle stays declarative ("compute and stash"); no
  message-passing protocol to test or maintain.
- Diverges from the PRD's "last-evaluated value" phrasing; this ADR
  records the deviation.

## Alternatives considered

- **`format: 'iife'` with `globalName`**: produces `var X = (() => { … })()`
  but then the entry must export the value, not just compute it as a
  side effect. Possible but uglier than the stash-and-read.
- **Single classic script (no bundler)**: would need to ship Readability
  and Turndown as separate `files` and pre-compose them — extra
  build-script work and three `files` entries instead of one.
- **`sendMessage` from content script**: turns the SW into a stateful
  request matcher waiting on an inbound event, and complicates error
  surfacing when the capture throws synchronously.

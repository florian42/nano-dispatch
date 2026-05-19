# ADR-0006: Skip extraction; capture raw `document.body.innerHTML`

Status: Accepted
Date: 2026-05-19

Supersedes: [ADR-0002](./0002-two-step-capture-injection.md) (the two-step
stash-and-read pattern existed only to inject a bundled
Readability + Turndown payload that no longer exists)

## Context

The PRD's User Stories #25 and #26 motivated a Readability + Turndown
extraction pipeline so the downstream LLM agent would receive a compact,
boilerplate-stripped Markdown payload instead of raw HTML "tag soup".
The dispatcher took a `bodyMarkdown` field on its payload, and a
`capture-script.ts` content script bundled Readability + Turndown
(~100 KB) was injected on every Send.

That pipeline pulled in two npm dependencies, required esbuild to bundle
the content script (the two libs can't be referenced from a `func:`
serialised function), and forced the two-step `executeScript` dance
(ADR-0002) because esbuild's IIFE wrapping ate the
last-evaluated-value semantics.

The user asked: "can we get rid of the bundling step? I like simple."

## Decision

Send the page as raw HTML. The service worker's capture step collapses
to a single `executeScript` call with an inline `func`:

```ts
const [first] = await chrome.scripting.executeScript({
  target: { tabId },
  func: () => ({
    url: location.href,
    title: document.title,
    selection: window.getSelection()?.toString() ?? '',
    bodyHtml: document.body.innerHTML,
  }),
});
```

The dispatcher's payload field is renamed `bodyMarkdown` → `bodyHtml`;
the `## Page` section now contains HTML.

## Consequences

What we lose:

- Boilerplate stripping. Nav, footer, scripts, inline styles inside
  `<body>` all ride along. Token cost per dispatch grows
  proportionally — a typical news article may chunk into 5–20×
  more Telegram messages than the Markdown-extracted version would.
- The "agent sees a structured Markdown article" promise of User
  Stories #25 / #26. The agent now has to parse HTML itself.

What we gain:

- One inline `func`. No `capture-script.ts`. No vendored deps. No
  esbuild — the project builds with `tsc -p tsconfig.build.json`
  plus three `cp`s. `build.mjs` is 15 lines.
- ADR-0002's stash-and-read pattern is retired.
- ~120 KB removed from `dist/` (Readability + Turndown + bundler glue).
- 5 jsdom-driven `extract.test.ts` cases retired; the new capture
  surface is too thin to warrant unit tests.

Mitigations remaining honest:

- Telegram rate limiting on long articles is more likely. The
  dispatcher's `rate_limited` discriminant surfaces this honestly to
  the user, who retries.
- The downstream agent (`nanoclaw`) is now responsible for any
  HTML→text reduction it needs. The trade was made knowing this.

## Alternatives considered

- **`document.body.innerText`** — also extraction-free, ~10× smaller
  than HTML, loses headings / links / code-block structure but keeps
  paragraphs. Recommended as a middle ground; the user picked raw HTML
  for now with the explicit option to revisit.
- **Send only URL + selection + note**, let the agent fetch the page
  itself: rejected because it breaks the reading-context case where
  the user is logged in / behind a paywall / looking at SPA-rendered
  content the agent can't re-fetch.
- **Keep the extraction pipeline**: rejected — the simplicity gain
  is significant (one fewer build tool, two fewer runtime deps, two
  fewer source files, one retired ADR).

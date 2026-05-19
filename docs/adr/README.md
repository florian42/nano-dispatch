# Architecture Decision Records

Decisions made while building nano-dispatch that aren't already
specified in `PRD.md` or `docs/telegram-dispatch.md`. Each ADR records
the *why*, including alternatives considered, so future readers can
judge edge cases.

- [0001 — Injectable `fetch` in the dispatcher](./0001-injectable-fetch-in-dispatcher.md)
- [0002 — Two-step capture injection (stash-and-read)](./0002-two-step-capture-injection.md) — **superseded by 0006**
- [0003 — Side panel as `mountSidePanel(root, ports)`](./0003-side-panel-controller-ports.md)
- [0004 — `disable_web_page_preview: true` on every send](./0004-disable-web-page-preview.md)
- [0005 — Splitter always chunks the composed body as one stream](./0005-splitter-degenerate-fallback.md)
- [0006 — Skip extraction; capture raw `document.body.innerHTML`](./0006-raw-html-capture.md)
- [0007 — Simplification pass: drop live selection, persisted drafts, options Test button](./0007-simplification-pass.md)

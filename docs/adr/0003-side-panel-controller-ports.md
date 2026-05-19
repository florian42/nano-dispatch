# ADR-0003: Side panel as `mountSidePanel(root, ports)` controller

Status: Accepted
Date: 2026-05-19

## Context

The PRD's Testing Decisions explicitly mark side-panel DOM rendering as
out of scope for automated tests:

> Side panel DOM rendering. It's a shallow translation of state → DOM;
> integration value is low and maintenance cost is high.

After the initial implementation we revisited that call: the side
panel had grown to ~150 lines of stateful behaviour (selection chip
mirroring, draft persistence with debounce, Cmd+Enter shortcut, send
flow with status line, tab-change refresh) — non-trivial logic that
would benefit from regression coverage. Adding tests directly to the
procedural script meant either monkey-patching `chrome.*` globals or
running a full Chrome harness.

## Decision

Split the side panel into three files:

- **`src/sidepanel/template.ts`** — the markup as a single template
  string. Single source of truth; the HTML page mounts it, tests mount
  it.
- **`src/sidepanel/controller.ts`** — `mountSidePanel(root, ports)`.
  Wires DOM events to behaviour. No `chrome.*` reference. Takes a
  `SidePanelPorts` interface with five ports
  (`tabs / draft / config / runtime / scripting`).
- **`src/sidepanel/sidepanel.ts`** — the entry. Thin adapter that
  constructs real ports from `chrome.*` and calls `mountSidePanel`.

Tests build stub ports as plain functions whose `state` is inspected
directly after driving the DOM with `@testing-library/dom` +
`user-event`. No mocks, no `vi.mock`.

## Consequences

- Twelve component tests now cover observable side-panel behaviour
  (mount render, selection mirroring, draft restore, send happy path
  + failure + missing-config, Cmd+Enter shortcut, debounce, options
  link, tab update). They survive markup changes because they query
  by role/text.
- The HTML page is now nearly empty (styles + `<script>`); the
  template lives in TypeScript. This trades the "HTML is the truth"
  convention for a single-source guarantee that tests and production
  render the same DOM.
- The entry-point adapter must be reviewed by hand — it has no test
  coverage and is the only place where the chrome.* API surface is
  consumed.

## Alternatives considered

- **Keep the PRD's "no side-panel tests" stance**: rejected once the
  module crossed the size threshold where regressions become easy and
  manual testing tedious.
- **Use `vi.stubGlobal('chrome', …)`**: shares the testability seam
  with production but pollutes the global namespace and is invisible
  in the types.
- **Adopt a UI framework** (Svelte / Preact): PRD explicitly forbids.
  Ports + a hand-rolled controller is the framework-free equivalent.

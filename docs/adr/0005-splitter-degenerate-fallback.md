# ADR-0005: Splitter degenerate-case fallback char-splits the composed body

Status: Accepted
Date: 2026-05-19

## Context

`docs/telegram-dispatch.md` §4 describes the splitter as
section-anchored: part 1 carries the structural frame (title, URL,
full `## Selection`, full `## Note`, `## Page` header) plus as much
page prefix as fits in 4032 chars; parts 2..N are pure `## Page`
continuation.

It also calls out a degenerate case:

> if the headers + Selection + Note alone exceed the part-1 budget
> (e.g. a 5000-char user selection), the Selection or Note sections
> themselves are allowed to split across parts — accepted as rare and
> "weird input, weird output, still arrives."

The doc states the *outcome* (the message still arrives, sections may
split) but not the *algorithm*.

## Decision

When `part1Frame.length >= 4032` — i.e. the title + URL + Selection +
Note alone already overflow the per-part body budget — the splitter
abandons section anchoring and chunks the entire composed body as a
single character stream, picking the best available split point
(paragraph → line → character) per chunk. Each chunk is wrapped with
`source: browser\n(n/N)\n\n`.

The `source: browser\n\n` prefix from the composed body is stripped
before chunking so it doesn't appear twice in part 1.

This is implemented as `splitDegenerate(composed)` in
`src/dispatcher/split.ts`.

## Consequences

- Pathological inputs (a 6000-char selection with no note and no page
  content; a 10000-char URL) still deliver. Every part is under
  4096 chars and every part carries the `source: browser` marker, so
  the downstream agent can still detect browser-origin.
- Parts 2..N in the degenerate case do *not* carry semantic section
  boundaries — they're arbitrary cuts through whatever text was
  flowing past the budget. This is what "weird input, weird output"
  buys us.
- The non-degenerate path (the common one) is unchanged: section-
  anchored splitting with paragraph-preferred boundaries, exercised
  by `tests/dispatcher/split.test.ts`.

## Alternatives considered

- **Refuse to dispatch when the frame overflows** and surface an
  error. Rejected — the PRD explicitly accepts the weird-input case
  ("still arrives"). The user should not have a paste of their own
  selection silently rejected.
- **Truncate the Selection/Note to fit**: silent data loss. Worse
  than ugly chunks.
- **Recursively re-section across parts** (Selection 1/2, Selection
  2/2, then Note, then Page): more code for a case that occurs once
  in a thousand sends; the simple char-split is the dumb-and-correct
  fallback.

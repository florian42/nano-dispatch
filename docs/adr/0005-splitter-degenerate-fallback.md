# ADR-0005: Splitter always chunks the composed body as one stream

Status: Accepted (revised 2026-05-19; supersedes the section-anchored
splitter the doc originally described)
Date: 2026-05-19

## Context

`docs/telegram-dispatch.md` §4 originally described a section-anchored
splitter: part 1 carries the structural frame (title, URL, full
`## Selection`, full `## Note`, `## Page` header) plus as much page
prefix as fits in 4032 chars; parts 2..N are pure `## Page`
continuation. A degenerate fallback chunked the entire composed body
when the frame itself overflowed 4032 chars.

Two algorithms — section-anchored for the common case, char-stream for
the rare one — for a behavioural difference that in practice was
invisible: in both, part 1 contains the frame and parts 2..N do not.

## Decision

There is only one algorithm. `composeForTelegram(payload)`:

1. Compose the body via `composeBody`.
2. If it fits in 4096, return `[composed]`.
3. Otherwise, strip the leading `source: browser\n\n`, chunk the
   remainder at paragraph/line boundaries with a 4032-char budget, and
   prepend `source: browser\n(n/N)\n\n` to each chunk.

The `findSplitPoint` helper prefers a `\n\n` (then `\n`) only when the
break sits in the upper half of the budget — otherwise it hard-cuts at
the budget. This keeps part 1 from being truncated to "frame only" when
the page body has no internal paragraph breaks.

Implemented in `src/dispatcher/compose.ts`.

## Consequences

- One code path, one place to test. `tests/dispatcher/split.test.ts`
  covers single-part, multi-part, frame-only-in-part-1, and paragraph-
  boundary cases — all under the same function.
- Pathological inputs (6000-char selection with no note and no page;
  a 10000-char URL) still deliver. Every part is ≤4096 chars and
  carries the `source: browser` marker.
- The "frame only in part 1, parts 2..N pure page continuation"
  invariant is now an emergent property of `composeBody`'s ordering
  (the frame is at the top of the composed string) rather than a
  structural rule enforced by a second algorithm.

## Alternatives considered

- **Keep the section-anchored algorithm.** Rejected — two algorithms
  for one observable behaviour. ADR-0005 (original) accepted the
  degenerate path as a fallback; once you accept it, you don't need
  the other path.
- **Truncate the Selection/Note to fit**: silent data loss.
- **Refuse to dispatch when frame overflows**: the user should not
  have a paste of their own selection silently rejected.

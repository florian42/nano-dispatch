# ADR-0013: Ship the page and the selection as two files in one media group

Status: Accepted
Date: 2026-05-24

Amends: [ADR-0006](./0006-raw-html-capture.md) (raw-HTML page capture is
unchanged; this ADR only changes how the *selection* is packaged)

## Context

After the switch to a single HTML-document send (commit `8884a23`), the
dispatch was: a short caption (`source: browser`, title, url, optional note)
plus one `*.html` attachment. The selection was "baked in" to that HTML as a
`<blockquote>` under an `<h2>Selection</h2>` section.

The user reported that the app "doesn't send the text I selected." It did —
but only buried inside the HTML attachment. From the chat, the visible
message (the caption) showed title/url/note; the highlight was invisible
unless you opened the file. The note made it into the caption, the selection
did not — an asymmetry no decision justified and no test covered. It also
contradicted PRD US-6 and US-16, which call for the selection to be part of
what's dispatched and clearly sectioned.

The user's chosen fix: send the selection as **its own file**, so the full
highlight is preserved, and make it **obvious to the downstream agent** which
file is the page and which is the selection.

## Decision

A dispatch is now a **media group (album)** of one or two documents:

- `page-<slug>.html` — always. The standalone page document (title, url,
  optional note, raw `document.body.innerHTML`). The `<h2>Selection</h2>`
  section is **removed** — the selection no longer lives here.
- `selection-<slug>.txt` — only when a selection exists. Plain text (the
  selection is plain text; no markup to preserve), carrying the **full**
  highlight after a `role: selection` header block.

Role is signalled three ways so the agent never guesses:

1. **Filename prefix** — `page-` vs `selection-`.
2. **In-file marker** — `<meta name="x-dispatch-role" content="page">` /
   `source: browser (role: page)` in the page; a `role: selection` header in
   the selection file.
3. **Per-file caption** — the captions are the agent's first read, before it
   opens any attachment, so each describes how the pieces relate (it
   *describes*, it does not *instruct* — intent lives in the note). The page
   caption is the summary plus, when a highlight is present, a trailing line
   naming the selection file. The selection caption describes the attached
   text (`This file is the exact text the user highlighted on the page`) and
   points back to the page file for context.

The `Sender` port ([ADR-0010](./0010-dispatcher-sender-port.md)) changes from
`sendDocument(one)` to `sendDocuments({ peer, files })` returning
`{ messageIds }`. The GramJS adapter sends a scalar file as before when there
is one, and passes arrays for `file` and `caption` when there are two —
GramJS routes the array case through `messages.SendMultiMedia`, delivering a
single grouped message with one caption per file.

## Consequences

- The highlight is preserved in full and is a first-class, labelled artefact
  in the chat — no truncation, no burial. Satisfies US-6 / US-16.
- Still **one logical send** (a media group), so the rate-limit win that drove
  the move away from chunked `sendMessage` is preserved — see §3 of
  `docs/telegram-dispatch.md`.
- The selection is no longer in the page HTML. An agent that previously parsed
  `<h2>Selection</h2>` out of the page file must now read the selection file.
  The role markers make that switch unambiguous.
- `messageIds` can now have length 2. The side panel's "Sent (N messages)"
  line reflects this honestly (1 for page-only, 2 with a selection).
- Both files are still attachments — the selection is readable in full but
  behind a tap, not inline in the chat scroll. Accepted: the user explicitly
  preferred full fidelity in a dedicated file over an inline caption preview.

## Alternatives considered

- **Add the selection to the caption** (truncated to the 1024-char limit).
  Makes the highlight visible inline without opening anything, but truncates
  long selections — the opposite of the user's "full highlight" goal.
- **Two separate (ungrouped) sends.** Two messages instead of one album:
  noisier in the chat and two RPCs instead of one grouped send, for no benefit
  over a media group.
- **Keep the selection baked into the page HTML.** The status quo that
  produced the bug report. Rejected.
